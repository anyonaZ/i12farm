'use server';

import { revalidatePath } from 'next/cache';
import { audit, createSignInLink } from '@/lib/auth/accounts';
import { getViewer } from '@/lib/auth/viewer';
import { dbMessage, withUser } from '@/lib/db';

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
