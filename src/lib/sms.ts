import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { demoMode } from '@/lib/demo';

// SMS through Africa's Talking (Kenya's common SMS/USSD gateway), written
// against its REST API with fetch (no SDK).
//
// SMS_ENV
//   simulate    default when AT_API_KEY is not set. Messages are rendered and
//               stored in the outbox with status "simulated"; nothing is sent.
//               Admin → Messages shows exactly what would have gone out.
//   sandbox     Africa's Talking sandbox (username "sandbox"); messages show
//               in the sandbox phone simulator at developers.africastalking.com.
//   production  live, after you buy SMS credit and (optionally) a sender ID.
//
// Check against the AT dashboard before going live: endpoint, sender ID, and
// the opt-out rules for bulk (promotional) SMS on your account.

export type SmsMode = 'simulate' | 'sandbox' | 'production';

export const smsMode: SmsMode = ((): SmsMode => {
  const env = process.env.SMS_ENV;
  if (env === 'sandbox' || env === 'production' || env === 'simulate') return env;
  return process.env.AT_API_KEY ? 'sandbox' : 'simulate';
})();

const ENDPOINT =
  smsMode === 'production'
    ? 'https://api.africastalking.com/version1/messaging'
    : 'https://api.sandbox.africastalking.com/version1/messaging';
const USERNAME = process.env.AT_USERNAME ?? (smsMode === 'sandbox' ? 'sandbox' : '');
const SENDER = process.env.AT_SENDER_ID ?? ''; // alphanumeric sender ID or short code; empty = AT's shared code
const CALLBACK_SECRET = process.env.SMS_CALLBACK_SECRET ?? '';
const USSD_SECRET = process.env.USSD_SECRET ?? '';

export interface SmsResult {
  phone: string; // 2547XXXXXXXX
  ok: boolean;
  messageId?: string;
  costKes?: number;
  error?: string;
}

/** Send one message to up to 100 phones (254XXXXXXXXX). */
export async function sendSms(phones: string[], message: string): Promise<SmsResult[]> {
  if (smsMode === 'simulate') return phones.map((phone) => ({ phone, ok: true, messageId: `SIM-${Date.now()}-${phone.slice(-4)}` }));
  if (!process.env.AT_API_KEY || !USERNAME) throw new Error('AT_USERNAME and AT_API_KEY must be set');

  const form = new URLSearchParams({ username: USERNAME, to: phones.map((p) => `+${p}`).join(','), message });
  if (SENDER) form.set('from', SENDER);
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { apiKey: process.env.AT_API_KEY, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await response.json().catch(() => null)) as {
    SMSMessageData?: {
      Message?: string;
      Recipients?: { number: string; status: string; statusCode: number; messageId?: string; cost?: string }[];
    };
  } | null;
  const recipients = json?.SMSMessageData?.Recipients;
  if (!response.ok || !recipients) {
    const reason = json?.SMSMessageData?.Message ?? `SMS request failed (${response.status})`;
    return phones.map((phone) => ({ phone, ok: false, error: reason }));
  }
  return phones.map((phone) => {
    const r = recipients.find((x) => x.number.replace(/\D/g, '') === phone);
    if (!r) return { phone, ok: false, error: 'Not in provider response' };
    // 100 Processed, 101 Sent, 102 Queued; anything else is a failure (e.g. 403 invalid number, 405 low balance).
    const ok = r.statusCode >= 100 && r.statusCode <= 102;
    return {
      phone,
      ok,
      messageId: r.messageId && r.messageId !== 'None' ? r.messageId : undefined,
      costKes: parseCost(r.cost),
      error: ok ? undefined : r.status,
    };
  });
}

function parseCost(cost: string | undefined): number | undefined {
  const m = cost?.match(/([0-9]+(?:\.[0-9]+)?)/);
  return m ? Number(m[1]) : undefined;
}

function secretMatches(candidate: string, secret: string): boolean {
  // Without a secret the callbacks only work in demo mode (see src/lib/demo.ts).
  if (!secret) return demoMode && smsMode === 'simulate' && candidate === 'unset';
  const a = Buffer.from(candidate);
  const b = Buffer.from(secret);
  return secret.length >= 24 && a.length === b.length && timingSafeEqual(a, b);
}

/** Delivery reports and incoming SMS come to /api/sms/{delivery,inbound}/<SMS_CALLBACK_SECRET>. */
export const isSmsCallbackSecret = (candidate: string) => secretMatches(candidate, CALLBACK_SECRET);
/** USSD requests come to /api/ussd/<USSD_SECRET>. */
export const isUssdSecret = (candidate: string) => secretMatches(candidate, USSD_SECRET);
