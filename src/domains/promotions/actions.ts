'use server';

import { revalidatePath } from 'next/cache';
import { getViewer } from '@/lib/auth/viewer';
import { recordEvent } from '@/lib/analytics/server';
import { dbMessage, withUser } from '@/lib/db';
import { toInternational } from '@/lib/phone';
import { requestPromotionPayment, simulatePromotionPayment } from '@/domains/orders/payments';

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string; detail?: string };

/** Choose a plan and send the M-Pesa prompt to the given phone. */
export async function buyFeatured(farmId: string, days: number, phone: string): Promise<Result<{ promotionId: string }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signedOut' };
  const intl = toInternational(phone);
  if (!intl) return { ok: false, error: 'phone' };
  let promotionId: string;
  try {
    promotionId = await withUser(viewer.id, async (tx) => {
      const [row] = await tx<{ id: string }[]>`select id from public.request_promotion(${farmId}, ${days})`;
      await recordEvent(tx, { name: 'promotion.started', userId: viewer.id, properties: { farm: farmId, days }, path: '/my-farm/feature' });
      return row.id;
    });
  } catch (error) {
    return { ok: false, error: 'failed', detail: dbMessage(error) };
  }
  const pay = await requestPromotionPayment(viewer.id, promotionId, intl);
  if (!pay.ok) return { ok: false, error: pay.error, detail: pay.detail };
  return { ok: true, data: { promotionId } };
}

export async function retryFeaturedPayment(promotionId: string, phone: string): Promise<Result> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signedOut' };
  const intl = toInternational(phone);
  if (!intl) return { ok: false, error: 'phone' };
  const pay = await requestPromotionPayment(viewer.id, promotionId, intl);
  return pay.ok ? { ok: true, data: undefined } : { ok: false, error: pay.error, detail: pay.detail };
}

export async function simulateFeatured(promotionId: string, outcome: 'success' | 'cancel'): Promise<Result<{ state: string }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signedOut' };
  const state = await simulatePromotionPayment(viewer.id, promotionId, outcome);
  revalidatePath('/my-farm');
  revalidatePath('/');
  return { ok: true, data: { state } };
}
