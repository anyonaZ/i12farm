'use server';

import { revalidatePath } from 'next/cache';
import { getViewer } from '@/lib/auth/viewer';
import { recordEvent } from '@/lib/analytics/server';
import { dbMessage, withUser } from '@/lib/db';
import { toInternational } from '@/lib/phone';
import { refreshPayment, requestPayment, simulatePayment } from './payments';
import type { CartLine, OrderStatus } from './types';

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string; detail?: string };

export async function placeOrder(input: {
  farmId: string;
  items: CartLine[];
  fulfilment: 'pickup' | 'delivery';
  deliveryNote: string;
  buyerName: string;
  buyerPhone: string;
}): Promise<Result<{ number: string; payment: 'requested' | 'failed'; message?: string }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signedOut' };
  const phone = toInternational(input.buyerPhone);
  if (!phone) return { ok: false, error: 'phone' };
  const items = (input.items ?? [])
    .filter((i) => /^[0-9a-f-]{36}$/.test(i.listingId) && Number.isInteger(i.quantity) && i.quantity > 0)
    .slice(0, 20)
    .map((i) => ({ listing_id: i.listingId, quantity: i.quantity }));
  if (items.length === 0) return { ok: false, error: 'empty' };

  let order: { id: string; number: string; subtotal_kes: number };
  try {
    order = await withUser(viewer.id, async (tx) => {
      const [row] = await tx<{ id: string; number: string; subtotal_kes: number }[]>`
        select * from public.place_order(${tx.json({
          farm_id: input.farmId,
          items,
          fulfilment: input.fulfilment === 'delivery' ? 'delivery' : 'pickup',
          delivery_note: (input.deliveryNote ?? '').slice(0, 500),
          buyer_name: (input.buyerName || viewer.fullName || '').slice(0, 120),
          buyer_phone: phone,
        })})`;
      const [farm] = await tx<{ county_code: number }[]>`select county_code from public.farms where id = ${input.farmId}`;
      await recordEvent(tx, {
        name: 'order.placed',
        userId: viewer.id,
        countyCode: farm?.county_code ?? null,
        properties: { order: row.id, farm: input.farmId, items: items.length, total: row.subtotal_kes, fulfilment: input.fulfilment },
        path: '/checkout',
      });
      return row;
    });
  } catch (error) {
    return { ok: false, error: 'placeFailed', detail: dbMessage(error) };
  }

  // Phone saved on the profile for next time, if there wasn't one.
  if (!viewer.contactPhone) {
    await withUser(
      viewer.id,
      (tx) => tx`update public.profiles set phone = ${'+' + phone} where id = ${viewer.id} and phone is null`,
    ).catch(() => undefined);
  }

  const pay = await requestPayment(viewer.id, order.id, phone);
  revalidatePath('/orders');
  return {
    ok: true,
    data: { number: order.number, payment: pay.ok ? 'requested' : 'failed', message: pay.ok ? pay.message : pay.detail },
  };
}

export async function payOrder(orderId: string, phone?: string): Promise<Result<{ message: string }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signedOut' };
  const intl = phone ? toInternational(phone) : null;
  if (phone && !intl) return { ok: false, error: 'phone' };
  const result = await requestPayment(viewer.id, orderId, intl);
  if (!result.ok) return { ok: false, error: result.error, detail: result.detail };
  revalidatePath('/orders');
  return { ok: true, data: { message: result.message } };
}

export async function checkPayment(orderId: string): Promise<Result<{ state: string }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signedOut' };
  const state = await refreshPayment(viewer.id, orderId);
  return { ok: true, data: { state } };
}

export async function simulate(orderId: string, outcome: 'success' | 'cancel'): Promise<Result<{ state: string }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signedOut' };
  const state = await simulatePayment(viewer.id, orderId, outcome);
  revalidatePath('/orders');
  return { ok: true, data: { state } };
}

export async function changeOrderStatus(orderId: string, status: OrderStatus, note?: string): Promise<Result> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signedOut' };
  try {
    await withUser(viewer.id, async (tx) => {
      await tx`select public.set_order_status(${orderId}, ${status}::public.order_status, ${note?.slice(0, 500) ?? null})`;
      await recordEvent(tx, {
        name: 'order.status_changed',
        userId: viewer.id,
        properties: { order: orderId, to: status },
        path: '/orders',
      });
    });
  } catch (error) {
    return { ok: false, error: 'statusFailed', detail: dbMessage(error) };
  }
  revalidatePath('/orders');
  revalidatePath('/my-farm');
  return { ok: true, data: undefined };
}

export async function leaveReview(orderId: string, rating: number, body: string): Promise<Result> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'signedOut' };
  const stars = Math.round(Number(rating));
  if (!(stars >= 1 && stars <= 5)) return { ok: false, error: 'rating' };
  try {
    await withUser(viewer.id, async (tx) => {
      await tx`select public.leave_review(${orderId}, ${stars}, ${(body ?? '').slice(0, 1000)})`;
      await recordEvent(tx, { name: 'review.left', userId: viewer.id, properties: { order: orderId, rating: stars }, path: '/orders' });
    });
  } catch (error) {
    return { ok: false, error: 'reviewFailed', detail: dbMessage(error) };
  }
  revalidatePath('/orders');
  revalidatePath('/');
  return { ok: true, data: undefined };
}
