import 'server-only';
import { after } from 'next/server';
import { createTranslator } from 'use-intl/core';
import webpush from 'web-push';
import en from '../../messages/en.json';
import sw from '../../messages/sw.json';
import { getSql } from '@/lib/db';

// Web push (free): the browser's push service (Google's for Chrome/Android,
// Mozilla's, Apple's) delivers to the phone even when i12farm is closed.
// Database triggers fill public.push_outbox; this file writes the text in the
// person's language and sends it. Keys: `npx web-push generate-vapid-keys`.
//
// Sending happens right after the request that caused it (after()), when
// anyone's app checks its badges (at most every 20 s per server), and from
// /api/cron/maintenance. Nothing is lost if a send fails: rows retry up to 5 times.

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? '';
const SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:support@i12farm.app';

export const pushConfigured = Boolean(PUBLIC_KEY && PRIVATE_KEY);
if (pushConfigured) webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);

const MESSAGES = { en, sw } as const;
type Template = keyof typeof en.push;

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

let categories: Record<string, { en: string; sw: string }> = {};

export function render(locale: string, template: string, params: Record<string, unknown>, url: string, tag: string): PushPayload {
  const lang = locale === 'sw' ? 'sw' : 'en';
  const t = createTranslator({ locale: lang, messages: MESSAGES[lang], namespace: 'push' });
  const key = (template in en.push ? template : 'test') as Template;
  const values = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v ?? '')]));
  if (key === 'vetRequest') {
    values.animal = categories[values.animal]?.[lang] ?? values.animal;
    values.near = values.place ? t('vetNear.body', { place: values.place }) : '';
    values.today = values.urgency === 'today' ? t('vetToday.body') : '';
  }
  return { title: t(`${key}.title`, values), body: t(`${key}.body`, values), url, tag };
}

type Row = {
  id: string;
  user_id: string;
  topic: string;
  template: string;
  params: Record<string, unknown>;
  url: string;
  locale: string;
  subscriptions: { endpoint: string; p256dh: string; auth: string }[];
};

let running: Promise<number> | null = null;
let lastRun = 0;

/** Sends what is waiting in the outbox. Safe to call often: one run at a time per server. */
export function sendPending(minGapMs = 0): Promise<number> {
  if (!pushConfigured) return Promise.resolve(0);
  if (running) return running;
  if (Date.now() - lastRun < minGapMs) return Promise.resolve(0);
  lastRun = Date.now();
  running = run().finally(() => {
    running = null;
  });
  return running;
}

async function run(): Promise<number> {
  const sql = getSql();
  let sent = 0;
  const cats = await sql<{ slug: string; name_en: string; name_sw: string }[]>`select slug, name_en, name_sw from public.farm_categories`;
  categories = Object.fromEntries(cats.map((c) => [c.slug, { en: c.name_en, sw: c.name_sw }]));
  for (let round = 0; round < 5; round++) {
    const rows = await sql<Row[]>`select * from public.claim_push_batch(100)`;
    if (!rows.length) break;
    for (const row of rows) {
      const payload = JSON.stringify(render(row.locale, row.template, row.params, row.url, `${row.topic}:${row.id}`));
      let delivered = false;
      let lastError: string | null = row.subscriptions.length ? null : 'no device';
      for (const s of row.subscriptions) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
            TTL: 24 * 3600,
            urgency: row.topic === 'messages' ? 'normal' : 'high',
            timeout: 10_000,
          });
          delivered = true;
          await sql`update public.push_subscriptions set last_sent_at = now(), failures = 0 where endpoint = ${s.endpoint}`;
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          lastError = `${status ?? ''} ${(error as Error).message}`.trim().slice(0, 300);
          // 404/410: the browser dropped this subscription (app removed, permission revoked).
          if (status === 404 || status === 410) {
            await sql`update public.push_subscriptions set disabled_at = now() where endpoint = ${s.endpoint}`;
          } else {
            await sql`update public.push_subscriptions set failures = failures + 1,
                        disabled_at = case when failures + 1 >= 20 then now() end
                      where endpoint = ${s.endpoint}`;
          }
        }
      }
      if (delivered || !row.subscriptions.length) {
        await sql`update public.push_outbox set sent_at = now(), last_error = ${lastError} where id = ${row.id}`;
        if (delivered) sent++;
      } else {
        await sql`update public.push_outbox set last_error = ${lastError} where id = ${row.id}`;
      }
    }
    if (rows.length < 100) break;
  }
  return sent;
}

/** Sends one notification straight to a person's devices (the "Send a test" button). */
export async function sendTest(userId: string, locale: string): Promise<number> {
  if (!pushConfigured) return 0;
  const sql = getSql();
  const subs = await sql<{ endpoint: string; p256dh: string; auth_secret: string }[]>`
    select endpoint, p256dh, auth_secret from public.push_subscriptions where user_id = ${userId} and disabled_at is null`;
  const payload = JSON.stringify(render(locale, 'test', {}, '/account', 'test'));
  let ok = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_secret } }, payload, {
        TTL: 600,
        timeout: 10_000,
      });
      ok++;
    } catch {
      /* counted as not sent */
    }
  }
  return ok;
}

/** Call from a server action or route after something that may notify people. */
export function kickPush(): void {
  if (!pushConfigured) return;
  after(() => sendPending().catch((e) => console.warn('push send failed', (e as Error).message)));
}
