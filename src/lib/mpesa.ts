import 'server-only';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { siteUrl } from '@/lib/env';

// M-Pesa Express (STK Push) through Safaricom Daraja, written against the
// documented REST endpoints with fetch (no SDK).
//
// MPESA_ENV
//   simulate    default when no consumer key is set. Nothing leaves the
//               server; the order page shows "Simulate payment" buttons so
//               the whole flow can be tested on a laptop.
//   sandbox     Daraja sandbox (test shortcode 174379 and its passkey).
//   production  live paybill or till, after Safaricom "Go Live".
//
// Callbacks are not signed by Safaricom, so (1) the callback URL carries a
// long secret, (2) a success callback is confirmed with an STK status query
// before the order is marked paid, and (3) the amount is checked in SQL.

export type MpesaMode = 'simulate' | 'sandbox' | 'production';

export const mpesaMode: MpesaMode = ((): MpesaMode => {
  const env = process.env.MPESA_ENV;
  if (env === 'sandbox' || env === 'production' || env === 'simulate') return env;
  return process.env.MPESA_CONSUMER_KEY ? 'sandbox' : 'simulate';
})();

const BASE = mpesaMode === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
const SHORTCODE = process.env.MPESA_SHORTCODE ?? '174379';
const PASSKEY = process.env.MPESA_PASSKEY ?? '';
const TRANSACTION_TYPE = process.env.MPESA_TRANSACTION_TYPE ?? 'CustomerPayBillOnline'; // or CustomerBuyGoodsOnline for a till
const PARTY_B = process.env.MPESA_PARTY_B ?? SHORTCODE; // till number when using Buy Goods
const CALLBACK_SECRET = process.env.MPESA_CALLBACK_SECRET ?? '';

let cachedToken: { value: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const basic = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
  const response = await fetch(`${BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { authorization: `Basic ${basic}` },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`M-Pesa auth failed (${response.status})`);
  const json = (await response.json()) as { access_token: string; expires_in: string | number };
  cachedToken = { value: json.access_token, expires: Date.now() + Number(json.expires_in) * 1000 };
  return cachedToken.value;
}

/** yyyyMMddHHmmss in Nairobi time, as Daraja expects. */
function timestamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`;
}

function password(ts: string): string {
  return Buffer.from(`${SHORTCODE}${PASSKEY}${ts}`).toString('base64');
}

export function callbackUrl(): string {
  const base = (process.env.MPESA_CALLBACK_BASE_URL ?? siteUrl).replace(/\/$/, '');
  return `${base}/api/mpesa/callback/${CALLBACK_SECRET || 'unset'}`;
}

export function isCallbackSecret(candidate: string): boolean {
  if (!CALLBACK_SECRET && mpesaMode === 'simulate') return candidate === 'unset';
  const a = Buffer.from(candidate);
  const b = Buffer.from(CALLBACK_SECRET);
  return CALLBACK_SECRET.length >= 24 && a.length === b.length && timingSafeEqual(a, b);
}

export interface StkResult {
  merchantRequestId: string;
  checkoutRequestId: string;
  customerMessage: string;
}

export async function stkPush(input: { phone: string; amount: number; reference: string; description: string }): Promise<StkResult> {
  if (mpesaMode === 'simulate') {
    const id = randomBytes(6).toString('hex');
    return { merchantRequestId: `SIM-${id}`, checkoutRequestId: `ws_CO_SIM_${id}`, customerMessage: 'Simulated: no prompt was sent' };
  }
  if (mpesaMode === 'production' && CALLBACK_SECRET.length < 24) throw new Error('MPESA_CALLBACK_SECRET must be set (24+ characters)');
  const ts = timestamp();
  const response = await fetch(`${BASE}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: SHORTCODE,
      Password: password(ts),
      Timestamp: ts,
      TransactionType: TRANSACTION_TYPE,
      Amount: Math.ceil(input.amount),
      PartyA: input.phone,
      PartyB: PARTY_B,
      PhoneNumber: input.phone,
      CallBackURL: callbackUrl(),
      AccountReference: input.reference.slice(0, 12),
      TransactionDesc: input.description.slice(0, 13),
    }),
    cache: 'no-store',
  });
  const json = (await response.json().catch(() => ({}))) as {
    MerchantRequestID?: string;
    CheckoutRequestID?: string;
    ResponseCode?: string;
    CustomerMessage?: string;
    errorMessage?: string;
  };
  if (!response.ok || json.ResponseCode !== '0' || !json.CheckoutRequestID) {
    throw new Error(json.errorMessage ?? `M-Pesa request failed (${response.status})`);
  }
  return {
    merchantRequestId: json.MerchantRequestID ?? '',
    checkoutRequestId: json.CheckoutRequestID,
    customerMessage: json.CustomerMessage ?? '',
  };
}

/** Ask Daraja for the result of an STK request. null = still waiting for the customer. */
export async function stkQuery(checkoutRequestId: string): Promise<{ resultCode: number; resultDesc: string } | null> {
  if (mpesaMode === 'simulate') return null;
  const ts = timestamp();
  const response = await fetch(`${BASE}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ BusinessShortCode: SHORTCODE, Password: password(ts), Timestamp: ts, CheckoutRequestID: checkoutRequestId }),
    cache: 'no-store',
  });
  const json = (await response.json().catch(() => ({}))) as { ResultCode?: string | number; ResultDesc?: string; errorCode?: string };
  if (json.ResultCode === undefined || json.ResultCode === null) return null; // e.g. "The transaction is being processed"
  return { resultCode: Number(json.ResultCode), resultDesc: json.ResultDesc ?? '' };
}

export interface StkCallback {
  checkoutRequestId: string;
  resultCode: number;
  resultDesc: string;
  receipt: string | null;
  amount: number | null;
  phone: string | null;
}

/** Daraja's callback body → the fields we keep. */
export function parseCallback(body: unknown): StkCallback | null {
  const cb = (body as { Body?: { stkCallback?: Record<string, unknown> } })?.Body?.stkCallback;
  if (!cb || typeof cb.CheckoutRequestID !== 'string') return null;
  const items = ((cb.CallbackMetadata as { Item?: { Name: string; Value?: unknown }[] } | undefined)?.Item ?? []).reduce<
    Record<string, unknown>
  >((acc, item) => ({ ...acc, [item.Name]: item.Value }), {});
  return {
    checkoutRequestId: cb.CheckoutRequestID,
    resultCode: Number(cb.ResultCode),
    resultDesc: String(cb.ResultDesc ?? ''),
    receipt: typeof items.MpesaReceiptNumber === 'string' ? items.MpesaReceiptNumber : null,
    amount: items.Amount === undefined ? null : Number(items.Amount),
    phone: items.PhoneNumber === undefined ? null : String(items.PhoneNumber),
  };
}

/** A callback body in Daraja's shape, used by simulate mode so both paths share one handler. */
export function simulatedCallback(checkoutRequestId: string, amount: number, phone: string, outcome: 'success' | 'cancel'): unknown {
  if (outcome === 'cancel') {
    return {
      Body: {
        stkCallback: {
          MerchantRequestID: 'SIM',
          CheckoutRequestID: checkoutRequestId,
          ResultCode: 1032,
          ResultDesc: 'Request cancelled by user',
        },
      },
    };
  }
  const receipt = 'SIM' + randomBytes(4).toString('hex').toUpperCase().slice(0, 7);
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: 'SIM',
        CheckoutRequestID: checkoutRequestId,
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: amount },
            { Name: 'MpesaReceiptNumber', Value: receipt },
            { Name: 'TransactionDate', Value: Number(timestamp()) },
            { Name: 'PhoneNumber', Value: Number(phone) },
          ],
        },
      },
    },
  };
}
