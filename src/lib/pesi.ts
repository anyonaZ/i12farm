import 'server-only';
import { createCipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { demoMode } from '@/lib/demo';
import { siteUrl } from '@/lib/env';

// Pesi Pay (Switchlink) gateway: M-Pesa STK collections, disbursements to
// mobile money, banks, tills and paybills, and receiver checks ("Hakikisha").
// Written from "PESI PORTAL API DOCUMENTATION (Updated)", with fetch and no SDK.
// NOT yet run against Pesi: there are no credentials. See README → Payments.
//
// PESI_ENV
//   simulate    default when no client id is set. Nothing leaves the server;
//               the order page shows "Simulate: pay" so the flow can be tested.
//   sandbox     Pesi's development (SIT) gateway.
//   production  the live gateway, once Switchlink has onboarded us.
//   off         a production build with no keys and no DEMO_MODE=true:
//               payments are refused (see src/lib/demo.ts).
//
// Pesi's callbacks are not signed, so (1) the callback URL carries a long
// secret, (2) a COMPLETED callback is confirmed with a status query before
// anything is marked paid, and (3) amounts are checked in SQL.

export type PesiMode = 'simulate' | 'sandbox' | 'production' | 'off';

export const pesiMode: PesiMode = ((): PesiMode => {
  const env = process.env.PESI_ENV;
  if (env === 'sandbox' || env === 'production') return env;
  if (env === 'simulate' || !process.env.PESI_CLIENT_ID) return demoMode ? 'simulate' : 'off';
  return 'sandbox';
})();

const BASE = (
  process.env.PESI_BASE_URL ?? (pesiMode === 'production' ? 'https://pesipaygw.slafrica.net' : 'https://sit-pesipaygw.slafrica.net')
).replace(/\/$/, '');
const API = `${BASE}/gateway/v1/Onboarding`;
const CLIENT_ID = process.env.PESI_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.PESI_CLIENT_SECRET ?? '';
const ENCRYPTION_KEY = process.env.PESI_ENCRYPTION_KEY ?? '';
/** The Pesi account that receives STK collections ("clientAccountReference"). */
const ACCOUNT_REFERENCE = process.env.PESI_ACCOUNT_REFERENCE ?? '';
/** The Pesi account that payouts and refunds are paid from ("sourceAccount"). */
export const SOURCE_ACCOUNT = process.env.PESI_SOURCE_ACCOUNT ?? '';
const CALLBACK_SECRET = process.env.PESI_CALLBACK_SECRET ?? '';
const TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * "credentials" for the token request: AES-256-ECB with PKCS7 padding of
 * "clientId:clientSecret" under the 64-hex-character encryption key, base64.
 * Same output as the CryptoJS pre-request script in Pesi's documentation
 * (checked byte for byte).
 */
export function encryptCredentials(clientId: string, clientSecret: string, hexKey: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) throw new Error('PESI_ENCRYPTION_KEY must be 64 hex characters');
  const cipher = createCipheriv('aes-256-ecb', Buffer.from(hexKey, 'hex'), null);
  return Buffer.concat([cipher.update(`${clientId}:${clientSecret}`, 'utf8'), cipher.final()]).toString('base64');
}

let cachedToken: { value: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const response = await fetch(`${API}/Authentication/oauth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // The documented script blanks clientSecret and sends it only inside "credentials".
    body: JSON.stringify({
      clientId: CLIENT_ID,
      clientSecret: '',
      credentials: encryptCredentials(CLIENT_ID, CLIENT_SECRET, ENCRYPTION_KEY),
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await response.json().catch(() => ({}))) as {
    response?: { accessToken?: string; expiresAt?: string; success?: boolean; remarks?: string };
  };
  const r = json.response;
  if (!response.ok || !r?.accessToken || r.success === false) {
    throw new Error(`Pesi sign-in failed (${response.status}${r?.remarks ? `: ${r.remarks}` : ''})`);
  }
  // expiresAt is UTC; fall back to 10 minutes if it is missing or unreadable.
  const expires = Date.parse(r.expiresAt ?? '') || Date.now() + 10 * 60_000;
  cachedToken = { value: r.accessToken, expires };
  return r.accessToken;
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, retried = false): Promise<{ status: number; json: T }> {
  const response = await fetch(`${API}/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 401 && !retried) {
    cachedToken = null; // token revoked or expired early: sign in once more
    return call(method, path, body, true);
  }
  const json = (await response.json().catch(() => ({}))) as T;
  return { status: response.status, json };
}

type Envelope = { success?: boolean; remarks?: string; errors?: { errorCode?: number | string; description?: string }[] | null };

function failure(status: number, json: Envelope, what: string): Error {
  const detail =
    json?.errors
      ?.map((e) => e.description)
      .filter(Boolean)
      .join('; ') || json?.remarks;
  return new Error(`Pesi ${what} failed (${status}${detail ? `: ${detail}` : ''})`);
}

/** A unique reference we generate for every collection or disbursement (Pesi rejects duplicates). */
export function newReference(kind: 'P' | 'D'): string {
  return `I12${kind}${randomBytes(12).toString('hex')}`; // 28 characters, e.g. I12P3f9a…
}

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

export function callbackUrl(): string {
  const base = (process.env.PESI_CALLBACK_BASE_URL ?? siteUrl).replace(/\/$/, '');
  return `${base}/api/pesi/callback/${CALLBACK_SECRET || 'unset'}`;
}

export function isCallbackSecret(candidate: string): boolean {
  if (!CALLBACK_SECRET && pesiMode === 'simulate' && demoMode) return candidate === 'unset';
  const a = Buffer.from(candidate);
  const b = Buffer.from(CALLBACK_SECRET);
  return CALLBACK_SECRET.length >= 24 && a.length === b.length && timingSafeEqual(a, b);
}

export type PesiState = 'processing' | 'completed' | 'failed' | 'unknown';

export interface PesiResult {
  partnerTransactionId: string;
  state: PesiState;
  statusCode: string;
  description: string;
  traceId: string | null;
  /** Present only if Pesi includes it (the documented callback does not). */
  amount: number | null;
  /** The M-Pesa receipt, if Pesi includes it. */
  receipt: string | null;
}

function stateOf(status: unknown, code: unknown): PesiState {
  const s = String(status ?? '').toUpperCase();
  if (s === 'COMPLETED' || s === 'SUCCESS' || s === 'SUCCESSFUL' || String(code) === 'AC100') return 'completed';
  if (s === 'FAILED' || s === 'FAILURE' || s === 'CANCELLED' || s === 'REVERSED') return 'failed';
  if (s === 'PROCESSING' || s === 'PENDING' || s === 'QUEUED') return 'processing';
  return 'unknown';
}

// Field names differ in case between Pesi's examples (Partner_transaction_id
// in callbacks, partnerTransactionId in requests), so look them up loosely.
function pick(obj: Record<string, unknown>, ...names: string[]): unknown {
  const wanted = names.map((n) => n.replace(/_/g, '').toLowerCase());
  for (const [k, v] of Object.entries(obj)) if (wanted.includes(k.replace(/_/g, '').toLowerCase())) return v;
  return undefined;
}

/** Pesi's callback body (collections and disbursements share one URL) → the fields we keep. */
export function parseCallback(body: unknown): PesiResult | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  const id = pick(o, 'Partner_transaction_id', 'partnerTransactionId', 'partnerReference');
  if (typeof id !== 'string' || !id) return null;
  const amount = pick(o, 'amount', 'Transaction_amount', 'sendAmount');
  const receipt = pick(o, 'MpesaReceiptNumber', 'Mpesa_receipt', 'receipt', 'Receipt_number', 'Third_party_reference');
  return {
    partnerTransactionId: id,
    state: stateOf(pick(o, 'Transaction_status', 'transactionStatus', 'status'), pick(o, 'Status_code', 'statusCode')),
    statusCode: String(pick(o, 'Status_code', 'statusCode') ?? ''),
    description: String(pick(o, 'Status_description', 'statusDescription', 'remarks') ?? ''),
    traceId: (pick(o, 'Trace_Id', 'traceId') as string | undefined) ?? null,
    amount: amount === undefined || amount === null || amount === '' ? null : Number(amount),
    receipt: typeof receipt === 'string' && receipt ? receipt : null,
  };
}

// ---------------------------------------------------------------------------
// Collections (M-Pesa STK push through Pesi)
// ---------------------------------------------------------------------------

export interface StkRequest {
  partnerReference: string;
  message: string;
}

export async function stkPush(input: { phone: string; amount: number; partnerReference: string }): Promise<StkRequest> {
  if (pesiMode === 'off') throw new Error('Payments are not set up on this server yet');
  if (pesiMode === 'simulate') return { partnerReference: input.partnerReference, message: 'Simulated: no prompt was sent' };
  if (CALLBACK_SECRET.length < 24) throw new Error('PESI_CALLBACK_SECRET must be set (24+ characters)');
  if (!ACCOUNT_REFERENCE) throw new Error('PESI_ACCOUNT_REFERENCE must be set');
  const { status, json } = await call<Envelope>('POST', 'TransactionsManagement/initiateStkPush', {
    phoneNumber: input.phone,
    partnerReference: input.partnerReference,
    clientAccountReference: ACCOUNT_REFERENCE,
    amount: Math.ceil(input.amount),
  });
  if (status >= 300 || json?.success === false) throw failure(status, json, 'payment request');
  return { partnerReference: input.partnerReference, message: json?.remarks ?? '' };
}

/**
 * Status of a collection or disbursement by our reference ("Fetch IPN / STK
 * Status"). The documentation gives no response example, so the fields are
 * looked for at the top level and inside "data". null = could not ask.
 */
export async function fetchStatus(partnerTransactionId: string): Promise<PesiResult | null> {
  if (pesiMode === 'simulate' || pesiMode === 'off') return null;
  const { status, json } = await call<Record<string, unknown>>(
    'GET',
    `TransactionsManagement/FetchIPNStatus?PartnerTransactionId=${encodeURIComponent(partnerTransactionId)}`,
  );
  if (status >= 300) return null;
  const data = json?.data;
  const inner = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  return parseCallback({ Partner_transaction_id: partnerTransactionId, ...stripEnvelope(json), ...(inner ?? {}) });
}

function stripEnvelope(json: Record<string, unknown> | null): Record<string, unknown> {
  if (!json) return {};
  const rest = { ...json };
  delete rest.data;
  delete rest.success;
  delete rest.errors;
  return rest;
}

// ---------------------------------------------------------------------------
// Disbursements (farmer payouts and buyer refunds) — used from Admin → Money
// ---------------------------------------------------------------------------

export type AccountType = 'MB' | 'BK' | 'PL' | 'TL' | 'PP';

/** "Hakikisha": the registered name on a mobile number, bank account, till, paybill or Pesi account. */
export async function validateReceiver(type: AccountType, accountNumber: string, bankCode?: string): Promise<string> {
  if (pesiMode === 'simulate') return 'SIMULATED NAME';
  if (pesiMode === 'off') throw new Error('Payments are not set up on this server yet');
  const q = new URLSearchParams({ AccountType: type, AccountNumber: accountNumber });
  if (type === 'BK') q.set('BankCode', bankCode ?? '');
  const { status, json } = await call<Envelope & { accountName?: string }>('POST', `TransactionsManagement/hakikisha?${q}`);
  if (status >= 300 || !json?.success || !json.accountName) throw failure(status, json, 'receiver check');
  return json.accountName;
}

export type Disbursement =
  | { channel: 'M'; receiverName: string; mobile: string; operator?: string }
  | { channel: 'B'; receiverName: string; bankName: string; bankCode: string; account: string }
  | { channel: 'PAYBILL'; receiverName: string; paybill: string; account: string }
  | { channel: 'TILL'; receiverName: string; till: string };

/** Pays out one amount. The result arrives later on the callback (and by fetchStatus). */
export async function disburse(input: Disbursement & { amount: number; partnerTransactionId: string; purpose: string; remarks: string }) {
  if (pesiMode === 'off') throw new Error('Payments are not set up on this server yet');
  if (!SOURCE_ACCOUNT && pesiMode !== 'simulate') throw new Error('PESI_SOURCE_ACCOUNT must be set');
  const body = {
    sendAmount: Number(input.amount.toFixed(2)),
    receiverFullName: input.receiverName,
    transactionType: input.channel === 'M' ? 'M' : input.channel === 'B' ? 'B' : 'B2B',
    mobileOperator: input.channel === 'M' ? (input.operator ?? 'Safaricom') : '',
    receiverMobile: input.channel === 'M' ? input.mobile : '',
    // For B2B the documentation puts the paybill/till number in receiverBank
    // and the account (or the till again) in receiverAccount.
    receiverBank:
      input.channel === 'B' ? input.bankName : input.channel === 'PAYBILL' ? input.paybill : input.channel === 'TILL' ? input.till : '',
    receiverAccount: input.channel === 'B' || input.channel === 'PAYBILL' ? input.account : input.channel === 'TILL' ? input.till : '',
    receiverBankCode: input.channel === 'B' ? input.bankCode : '',
    purposeOfFunds: input.purpose.slice(0, 60),
    remarks: input.remarks.slice(0, 60),
    partnerTransactionId: input.partnerTransactionId,
    sourceAccount: SOURCE_ACCOUNT,
  };
  if (pesiMode === 'simulate') return { accepted: true, remarks: 'Simulated: nothing was sent', request: body };
  const { status, json } = await call<Envelope>('POST', 'TransactionsManagement/Disburse/Single', body);
  if (status >= 300 || json?.success === false) throw failure(status, json, 'payout');
  return { accepted: true, remarks: json?.remarks ?? '', request: body };
}

/** Many mobile-money payouts in one request (each keeps its own reference and callback). */
export async function disburseBulkMobile(
  description: string,
  items: { amount: number; receiverName: string; mobile: string; partnerTransactionId: string }[],
) {
  if (pesiMode === 'off') throw new Error('Payments are not set up on this server yet');
  const body = {
    paymentDescription: description.slice(0, 60),
    sourceAccount: SOURCE_ACCOUNT,
    transactions: items.map((i) => ({
      sendAmount: Number(i.amount.toFixed(2)),
      receiverFullName: i.receiverName,
      mobileOperator: 'Safaricom',
      receiverMobile: i.mobile,
      partnerTransactionId: i.partnerTransactionId,
    })),
  };
  if (pesiMode === 'simulate') return { accepted: true, remarks: 'Simulated: nothing was sent', request: body };
  const { status, json } = await call<Envelope>('POST', 'TransactionsManagement/BulkDisburse/Mobile', body);
  if (status >= 300 || json?.success === false) throw failure(status, json, 'bulk payout');
  return { accepted: true, remarks: json?.remarks ?? '', request: body };
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export interface PesiAccount {
  clientID: string;
  accountNumber: string;
  accountBalance: string;
  billReference: string;
  accountName: string;
}

export async function accountDetails(): Promise<PesiAccount[]> {
  if (pesiMode === 'simulate' || pesiMode === 'off') return [];
  const { status, json } = await call<Envelope & { data?: PesiAccount[] }>('GET', 'AccountManagement/fetchAccountDetails');
  if (status >= 300 || !json?.success) throw failure(status, json, 'account details');
  return json.data ?? [];
}

/** Statement lines between two Nairobi times (for reconciliation). Shape undocumented: returned as is. */
export async function transactionHistory(from: Date, to: Date): Promise<unknown> {
  if (pesiMode === 'simulate' || pesiMode === 'off') return [];
  const fmt = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
  const q = new URLSearchParams({ FromDate: fmt(from), ToDate: fmt(to) });
  const { status, json } = await call<unknown>('GET', `TransactionsManagement/FetchTransactionHistory?${q}`);
  if (status >= 300) throw new Error(`Pesi statement failed (${status})`);
  return json;
}

/**
 * One-time: tell Pesi where to send callbacks for an account. Pesi accepts
 * this ONCE per account; changing it later needs their support team. Run it
 * through scripts/pesi-register-callback.mjs only when the final domain is live.
 */
export async function registerCallback(sourceAccount: string): Promise<string> {
  const url = callbackUrl();
  if (!url.startsWith('https://') || url.endsWith('/unset'))
    throw new Error('Set NEXT_PUBLIC_SITE_URL (https) and PESI_CALLBACK_SECRET first');
  const { status, json } = await call<Envelope>('POST', 'TransactionsManagement/callbacksex/register', {
    callbackUrl: url,
    sourceAccount,
  });
  if (status >= 300 || json?.success === false) throw failure(status, json, 'callback registration');
  return url;
}

/** Simulate mode: the callback Pesi would send. */
export function simulatedCallback(partnerTransactionId: string, outcome: 'success' | 'cancel'): Record<string, string> {
  const trace = randomBytes(16).toString('hex');
  return outcome === 'success'
    ? {
        Partner_transaction_id: partnerTransactionId,
        Status_code: 'AC100',
        Status_description: 'Transaction Processed Successfully',
        Trace_Id: `SIM-${trace}`,
        Transaction_status: 'COMPLETED',
      }
    : {
        Partner_transaction_id: partnerTransactionId,
        Status_code: 'AC300',
        Status_description: 'Request cancelled by user',
        Trace_Id: `SIM-${trace}`,
        Transaction_status: 'FAILED',
      };
}
