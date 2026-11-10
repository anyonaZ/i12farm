'use server';

import { revalidatePath } from 'next/cache';
import { getViewer } from '@/lib/auth/viewer';
import { dbMessage, withUser } from '@/lib/db';

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
const REASONS = ['fake', 'scam', 'wrong_info', 'offensive', 'other'];

export async function reportFarm(
  farmId: string,
  reason: string,
  note: string,
): Promise<Result<{ outcome: 'reported' | 'already' | 'hidden' }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signIn' };
  if (!/^[0-9a-f-]{36}$/.test(farmId) || !REASONS.includes(reason)) return { ok: false, error: 'invalid' };
  try {
    const [row] = await withUser(
      viewer.id,
      (tx) => tx<{ outcome: 'reported' | 'already' | 'hidden' }[]>`
      select public.report_farm(${farmId}, ${reason}, ${note.slice(0, 500)}) as outcome`,
    );
    if (row.outcome === 'hidden') revalidatePath('/');
    return { ok: true, data: { outcome: row.outcome } };
  } catch (error) {
    return { ok: false, error: dbMessage(error) };
  }
}

export async function resolveReports(farmId: string, action: 'dismissed' | 'suspended' | 'restored'): Promise<Result> {
  const viewer = await getViewer();
  if (!viewer?.roles.includes('admin')) return { ok: false, error: 'Admins only' };
  try {
    await withUser(viewer.id, (tx) => tx`select public.admin_resolve_reports(${farmId}, ${action})`);
    revalidatePath('/admin');
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: dbMessage(error) };
  }
}
