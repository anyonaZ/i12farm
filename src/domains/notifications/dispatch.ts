import 'server-only';
import { getSql } from '@/lib/db';
import { sendSms, smsMode } from '@/lib/sms';
import { renderSms, type SmsLocale } from './render';

// Sends what the database queued in public.notifications.
//
// Runs (1) right after an action that queued SMS (dispatchSoon), (2) every
// 30 s in the server process (instrumentation.ts), and (3) from the cron
// route, for hosts that freeze idle processes. Rows are claimed with
// FOR UPDATE SKIP LOCKED, so overlapping runs never send twice.

const MAX_ATTEMPTS = 3;

interface Row {
  id: number;
  phone: string;
  template: string;
  params: Record<string, unknown>;
  locale: SmsLocale;
  kind: 'transactional' | 'broadcast';
  attempts: number;
  body_en: string | null;
  body_sw: string | null;
}

export interface DispatchResult {
  claimed: number;
  sent: number;
  failed: number;
  capped: boolean;
  mode: string;
}

let running: Promise<DispatchResult> | null = null;

export function dispatchQueued(limit = 200): Promise<DispatchResult> {
  // One run at a time per process; callers share the result.
  running ??= run(limit).finally(() => {
    running = null;
  });
  return running;
}

let soon: ReturnType<typeof setTimeout> | null = null;
/** Fire-and-forget send shortly after an action queued SMS. */
export function dispatchSoon(): void {
  if (soon || !process.env.DATABASE_URL) return;
  soon = setTimeout(() => {
    soon = null;
    dispatchQueued().catch((error) => console.error('[sms] dispatch failed', error));
  }, 300);
}

async function run(limit: number): Promise<DispatchResult> {
  const sql = getSql();
  const [settings] = await sql<{ cap: number; ussd: string; today: number }[]>`
    select public.setting_int('sms_daily_cap', 1000) as cap,
           coalesce((select value #>> '{}' from public.platform_settings where key = 'ussd_code'), '') as ussd,
           (select count(*)::integer from public.notifications
             where sent_at >= date_trunc('day', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi') as today`;
  const room = Math.max(0, settings.cap - settings.today);
  if (room === 0) return { claimed: 0, sent: 0, failed: 0, capped: true, mode: smsMode };

  // Claim a batch: order and vet messages first, broadcasts after.
  const rows = await sql.begin(async (tx) => {
    const claimed = await tx<Row[]>`
      select n.id, n.phone, n.template, n.params, n.locale, n.kind, n.attempts, b.body_en, b.body_sw
      from public.notifications n
      left join public.broadcasts b on b.id = n.broadcast_id
      where n.status = 'queued'
      order by n.kind = 'broadcast', n.created_at
      limit ${Math.min(limit, room)}
      for update of n skip locked`;
    if (claimed.length) {
      await tx`update public.notifications set status = 'sending', attempts = attempts + 1, sent_at = now()
               where id = any(${claimed.map((r) => r.id)})`;
    }
    return claimed;
  });
  if (!rows.length) return { claimed: 0, sent: 0, failed: 0, capped: false, mode: smsMode };

  // Render, then group identical texts (broadcasts) into one API call per 100 phones.
  const groups = new Map<string, Row[]>();
  const empty: Row[] = [];
  for (const row of rows) {
    const body = renderSms(row.template, row.locale, row.params ?? {}, {
      ussdCode: settings.ussd,
      broadcast: row.body_en ? { body_en: row.body_en, body_sw: row.body_sw ?? row.body_en } : null,
    });
    if (!body) empty.push(row);
    else groups.set(body, [...(groups.get(body) ?? []), row]);
  }
  if (empty.length) {
    await sql`update public.notifications set status = 'failed', error = 'Unknown template' where id = any(${empty.map((r) => r.id)})`;
  }

  let sent = 0;
  let failed = empty.length;
  for (const [body, group] of groups) {
    for (let i = 0; i < group.length; i += 100) {
      const chunk = group.slice(i, i + 100);
      let results;
      try {
        results = await sendSms(
          chunk.map((r) => r.phone),
          body,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'send failed';
        results = chunk.map((r) => ({ phone: r.phone, ok: false, error: message }));
      }
      for (const row of chunk) {
        const r = results.find((x) => x.phone === row.phone) ?? { ok: false, error: 'No result' };
        if (r.ok) {
          sent++;
          await sql`update public.notifications
                       set status = ${smsMode === 'simulate' ? 'simulated' : 'sent'}, body = ${body},
                           provider_id = ${'messageId' in r ? (r.messageId ?? null) : null},
                           cost_kes = ${'costKes' in r ? (r.costKes ?? null) : null}, error = null
                     where id = ${row.id}`;
        } else {
          const retry = row.attempts + 1 < MAX_ATTEMPTS;
          if (!retry) failed++;
          await sql`update public.notifications
                       set status = ${retry ? 'queued' : 'failed'}, body = ${body}, error = ${('error' in r ? r.error : null) ?? 'failed'}
                     where id = ${row.id}`;
        }
      }
    }
  }
  return { claimed: rows.length, sent, failed, capped: rows.length >= room, mode: smsMode };
}

/** Africa's Talking delivery report → outbox row. */
export async function recordDelivery(providerId: string, status: string, reason: string | null): Promise<void> {
  const delivered = status === 'Success';
  const failed = status === 'Failed' || status === 'Rejected' || status === 'AbsentSubscriber';
  if (!delivered && !failed) return; // Sent / Submitted / Buffered: still on its way
  await getSql()`
    update public.notifications
       set status = ${delivered ? 'delivered' : 'failed'},
           delivered_at = case when ${delivered} then now() else delivered_at end,
           error = case when ${failed} then ${reason ?? status} else error end
     where provider_id = ${providerId} and status in ('sent', 'sending', 'delivered', 'failed')`;
}

/** STOP / ACHA / START from an incoming SMS. Returns the action taken. */
export async function handleInboundSms(from: string, text: string): Promise<'opt_out' | 'opt_in' | null> {
  const word = text.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
  const action = ['STOP', 'ACHA', 'SIMAMA', 'UNSUBSCRIBE', 'STOPALL'].includes(word)
    ? 'opt_out'
    : ['START', 'ANZA', 'SUBSCRIBE', 'YES'].includes(word)
      ? 'opt_in'
      : null;
  if (action) await getSql()`select public.set_phone_pref(${from}, ${action}, 'sms')`;
  return action;
}
