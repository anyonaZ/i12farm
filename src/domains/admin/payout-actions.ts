'use server';

import { revalidatePath } from 'next/cache';
import { getViewer } from '@/lib/auth/viewer';
import { dbMessage } from '@/lib/db';
import {
  approveAndSend,
  cancelBatch,
  checkBatch,
  prepareBatch,
  removeLine,
  savePayoutAccount,
  type PayoutAccountInput,
  type Skipped,
} from './disbursements';
import { kickPush } from '@/lib/push';

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

async function admin() {
  const viewer = await getViewer();
  return viewer?.roles.includes('admin') ? viewer : null;
}

// Database errors carry a code and a message written for people; Pesi and
// input errors are plain Errors with their own message.
function message(error: unknown): string {
  return (error as { code?: string })?.code ? dbMessage(error) : (error as Error)?.message || 'unexpected error';
}

export async function prepareBatchAction(
  picks: { kind: 'payout' | 'refund'; id: string; amount?: number }[],
  note: string,
): Promise<Result<{ batchId: string | null; number: string | null; skipped: Skipped[] }>> {
  const viewer = await admin();
  if (!viewer) return { ok: false, error: 'Admins only' };
  try {
    const data = await prepareBatch(viewer, picks.slice(0, 200), note.slice(0, 300));
    revalidatePath('/admin/payouts');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function approveBatchAction(batchId: string): Promise<Result<{ sent: number; refused: Skipped[] }>> {
  kickPush();
  const viewer = await admin();
  if (!viewer) return { ok: false, error: 'Admins only' };
  try {
    const data = await approveAndSend(viewer, batchId);
    revalidatePath('/admin/payouts');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function removeLineAction(lineId: string): Promise<Result> {
  const viewer = await admin();
  if (!viewer) return { ok: false, error: 'Admins only' };
  try {
    await removeLine(viewer, lineId);
    revalidatePath('/admin/payouts');
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function cancelBatchAction(batchId: string): Promise<Result> {
  const viewer = await admin();
  if (!viewer) return { ok: false, error: 'Admins only' };
  try {
    await cancelBatch(viewer, batchId);
    revalidatePath('/admin/payouts');
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function checkBatchAction(batchId: string): Promise<Result<{ checked: number; changed: number }>> {
  kickPush();
  const viewer = await admin();
  if (!viewer) return { ok: false, error: 'Admins only' };
  try {
    const data = await checkBatch(viewer, batchId);
    revalidatePath('/admin/payouts');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

/** Farm managers: save where the farm's money goes (the name is checked with Pesi first). */
export async function savePayoutAccountAction(farmId: string, input: PayoutAccountInput): Promise<Result<{ registeredName: string }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signedOut' };
  if (!/^[0-9a-f-]{36}$/.test(farmId) || !['M', 'B', 'PAYBILL', 'TILL'].includes(input.channel)) return { ok: false, error: 'invalid' };
  try {
    const data = await savePayoutAccount(viewer, farmId, input);
    revalidatePath(`/my-farm/${farmId}`);
    revalidatePath('/my-farm');
    return { ok: true, data };
  } catch (error) {
    const m = message(error);
    return { ok: false, error: ['phone', 'bank', 'business', 'account'].includes(m) ? m : `check:${m}` };
  }
}
