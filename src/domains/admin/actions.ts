'use server';

import { revalidatePath } from 'next/cache';
import { audit, createSignInLink } from '@/lib/auth/accounts';
import { getViewer } from '@/lib/auth/viewer';
import { dbMessage, getSql, withUser } from '@/lib/db';

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
const ROLES = ['farmer', 'buyer', 'provider', 'agent', 'partner', 'admin'];

async function admin() {
  const viewer = await getViewer();
  return viewer?.roles.includes('admin') ? viewer : null;
}

async function run(fn: (adminId: string) => Promise<void>, path = '/admin'): Promise<Result> {
  const viewer = await admin();
  if (!viewer) return { ok: false, error: 'Admins only' };
  try {
    await fn(viewer.id);
  } catch (error) {
    return { ok: false, error: dbMessage(error) };
  }
  revalidatePath(path);
  return { ok: true, data: undefined };
}

export async function setRoles(userId: string, roles: string[]) {
  const clean = roles.filter((r) => ROLES.includes(r));
  return run((me) =>
    withUser(me, (tx) => tx`select public.admin_set_roles(${userId}, ${clean}::public.user_role[])`).then(() => undefined),
  );
}

export async function setUserStatus(userId: string, status: 'active' | 'suspended') {
  return run((me) =>
    withUser(me, (tx) => tx`select public.admin_set_user_status(${userId}, ${status}, ${'admin screen'})`).then(() => undefined),
  );
}

export async function verifyFarm(farmId: string, verified: boolean) {
  return run((me) => withUser(me, (tx) => tx`select public.admin_verify_farm(${farmId}, ${verified})`).then(() => undefined));
}

export async function recordPayout(farmId: string, amount: number, reference: string) {
  return run((me) => withUser(me, (tx) => tx`select public.admin_record_payout(${farmId}, ${amount}, ${reference})`).then(() => undefined));
}

export async function recordRefund(orderId: string, reference: string) {
  return run((me) => withUser(me, (tx) => tx`select public.admin_record_refund(${orderId}, ${reference})`).then(() => undefined));
}

export async function setCommission(percent: number) {
  const bps = Math.round(Number(percent) * 100);
  return run((me) => withUser(me, (tx) => tx`select public.admin_set_setting('commission_bps', ${tx.json(bps)})`).then(() => undefined));
}

/**
 * A one-time sign-in link (48 h) for someone who forgot their password and
 * has no email. Read it out or send it by WhatsApp; it opens Account so they
 * can set a new password.
 */
export async function issueSignInLink(userId: string): Promise<Result<{ link: string }>> {
  const viewer = await admin();
  if (!viewer) return { ok: false, error: 'Admins only' };
  const link = await createSignInLink(userId, 'admin_link', viewer.id);
  await audit(viewer.id, userId, 'sign_in_link.issued');
  return { ok: true, data: { link } };
}

// ---------------------------------------------------------------------------
// Phase 2b: payout file import, settings, order upkeep
// ---------------------------------------------------------------------------

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

/**
 * Record payouts from a CSV with columns farm_id, amount_kes, reference (any
 * order, extra columns ignored). Each row is checked by admin_record_payout()
 * on its own, so one bad row never blocks the others.
 */
export async function importPayouts(form: FormData): Promise<Result<{ ok: number; failed: { row: number; reason: string }[] }>> {
  const viewer = await admin();
  if (!viewer) return { ok: false, error: 'Admins only' };
  const file = form.get('file');
  if (!(file instanceof Blob) || file.size === 0) return { ok: false, error: 'no file' };
  if (file.size > 1_000_000) return { ok: false, error: 'file larger than 1 MB' };
  const rows = parseCsv(await file.text());
  const header = (rows.shift() ?? []).map((h) => h.toLowerCase().replace(/^﻿/, ''));
  const col = (name: string) => header.indexOf(name);
  const [iFarm, iAmount, iRef] = [col('farm_id'), col('amount_kes'), col('reference')];
  if (iFarm < 0 || iAmount < 0 || iRef < 0) return { ok: false, error: 'columns farm_id, amount_kes and reference are required' };

  let ok = 0;
  const failed: { row: number; reason: string }[] = [];
  for (const [n, r] of rows.entries()) {
    const farmId = r[iFarm] ?? '';
    const amount = Number((r[iAmount] ?? '').replace(/[^\d.]/g, ''));
    const ref = (r[iRef] ?? '').toUpperCase();
    if (!ref) continue; // not paid yet: skip quietly
    if (!/^[0-9a-f-]{36}$/.test(farmId) || !(amount > 0)) {
      failed.push({ row: n + 2, reason: 'bad farm_id or amount' });
      continue;
    }
    try {
      await withUser(viewer.id, (tx) => tx`select public.admin_record_payout(${farmId}, ${amount}, ${ref})`);
      ok += 1;
    } catch (error) {
      failed.push({ row: n + 2, reason: dbMessage(error) });
    }
  }
  revalidatePath('/admin');
  return { ok: true, data: { ok, failed } };
}

export async function saveTradeSettings(input: { autoCompleteDays: number; unpaidHours: number; plans: string }) {
  const days = Math.round(Number(input.autoCompleteDays));
  const hours = Math.round(Number(input.unpaidHours));
  if (!(days >= 1 && days <= 30)) return { ok: false as const, error: 'days must be 1 to 30' };
  if (!(hours >= 2 && hours <= 336)) return { ok: false as const, error: 'hours must be 2 to 336' };
  const plans = input.plans
    .split('\n')
    .map((line) =>
      line
        .split(/[,;\s]+/)
        .filter(Boolean)
        .map(Number),
    )
    .filter((p) => p.length === 2)
    .map(([d, price]) => ({ days: Math.round(d), price: Math.round(price) }));
  if (plans.length === 0 || plans.some((p) => !(p.days >= 1 && p.days <= 365 && p.price >= 10 && p.price <= 100000))) {
    return { ok: false as const, error: 'plans: one per line, days 1-365 and price 10-100000' };
  }
  return run((me) =>
    withUser(me, async (tx) => {
      await tx`select public.admin_set_setting('auto_complete_days', ${tx.json(days)})`;
      await tx`select public.admin_set_setting('unpaid_cancel_hours', ${tx.json(hours)})`;
      await tx`select public.admin_set_setting('premium_plans', ${tx.json(plans)})`;
    }),
  );
}

export async function runUpkeep(): Promise<Result<Record<string, number>>> {
  const viewer = await admin();
  if (!viewer) return { ok: false, error: 'Admins only' };
  const [{ result }] = await getSql()<{ result: Record<string, number> }[]>`select public.run_maintenance() as result`;
  await audit(viewer.id, null, 'maintenance.run', result);
  revalidatePath('/admin');
  return { ok: true, data: result };
}
