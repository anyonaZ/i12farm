import 'server-only';
import { getSql, withUser } from '@/lib/db';
import { mpesaMode, parseCallback, simulatedCallback, stkPush, stkQuery, type StkCallback } from '@/lib/mpesa';
import { recordEvent } from '@/lib/analytics/server';

// Payment orchestration: ask M-Pesa for an STK prompt, then record the
// result exactly once. The database function record_payment_result() holds
// the money rules (amount check, ledger rows, stock); this file only talks
// to Daraja and passes results along.

export type PayError = 'notYours' | 'notPayable' | 'mpesa';

export async function requestPayment(
  userId: string,
  orderId: string,
  phone?: string | null,
): Promise<{ ok: true; checkoutRequestId: string; message: string } | { ok: false; error: PayError; detail?: string }> {
  const order = await withUser(userId, async (tx) => {
    const [row] = await tx<
      { id: string; number: string; status: string; subtotal_kes: number; buyer_phone: string; mine: boolean; recent: string | null }[]
    >`
      select o.id, o.number, o.status, o.subtotal_kes, o.buyer_phone, o.buyer_id = ${userId} as mine,
             (select p.checkout_request_id from public.payments p
               where p.order_id = o.id and p.status = 'requested' and p.requested_at > now() - interval '90 seconds'
               order by p.requested_at desc limit 1) as recent
      from public.orders o where o.id = ${orderId}`;
    return row;
  });
  if (!order || !order.mine) return { ok: false, error: 'notYours' };
  if (order.status !== 'awaiting_payment') return { ok: false, error: 'notPayable' };
  // A prompt is already on the phone: don't send another one yet.
  if (order.recent) return { ok: true, checkoutRequestId: order.recent, message: 'pending' };

  const payPhone = phone ?? order.buyer_phone;
  const amount = Math.round(order.subtotal_kes);
  let stk;
  try {
    stk = await stkPush({ phone: payPhone, amount, reference: `I12-${order.number}`, description: `Order ${order.number}` });
  } catch (error) {
    return { ok: false, error: 'mpesa', detail: (error as Error).message };
  }
  const sql = getSql();
  await sql`select public.record_payment_request(${order.id}, ${payPhone}, ${amount}, ${stk.merchantRequestId}, ${stk.checkoutRequestId}, ${userId})`;
  await withUser(userId, (tx) =>
    recordEvent(tx, { name: 'payment.requested', userId, properties: { order: order.id, amount, mode: mpesaMode }, path: '/orders' }),
  );
  return { ok: true, checkoutRequestId: stk.checkoutRequestId, message: stk.customerMessage };
}

/**
 * Apply an M-Pesa result. `confirm` = check success with Daraja first
 * (used for callbacks, which are unsigned). Returns the database verdict.
 */
export async function applyResult(cb: StkCallback, raw: unknown, confirm: boolean): Promise<string> {
  if (cb.resultCode === 0 && confirm && mpesaMode !== 'simulate') {
    const check = await stkQuery(cb.checkoutRequestId).catch(() => null);
    if (!check || check.resultCode !== 0) {
      console.warn('M-Pesa callback not confirmed by status query', cb.checkoutRequestId);
      return 'unconfirmed';
    }
  }
  const sql = getSql();
  const [{ result }] = await sql<{ result: string }[]>`
    select public.record_payment_result(${cb.checkoutRequestId}, ${cb.resultCode}, ${cb.resultDesc},
                                        ${cb.receipt}, ${cb.amount}, ${sql.json(raw as never)}) as result`;
  if (result === 'paid' || result === 'failed' || result === 'paid_after_cancel' || result === 'underpaid') {
    const [payment] = await sql<
      { order_id: string }[]
    >`select order_id from public.payments where checkout_request_id = ${cb.checkoutRequestId}`;
    await sql`
      insert into public.events (name, anonymous_id, properties, path)
      values (${result === 'failed' ? 'payment.failed' : 'payment.succeeded'}, 'server',
              ${sql.json({ order: payment?.order_id ?? null, result, code: cb.resultCode })}, '/api/mpesa/callback')`;
  }
  return result;
}

/** For a prompt that got no callback (phone off, callback lost): ask Daraja directly. */
export async function refreshPayment(userId: string, orderId: string): Promise<string> {
  const [pending] = await withUser(
    userId,
    (tx) => tx<{ checkout_request_id: string; old: boolean }[]>`
    select p.checkout_request_id, p.requested_at < now() - interval '20 seconds' as old
    from public.payments p join public.orders o on o.id = p.order_id
    where p.order_id = ${orderId} and p.status = 'requested' and o.buyer_id = ${userId}
    order by p.requested_at desc limit 1`,
  );
  if (!pending) return 'none';
  if (mpesaMode === 'simulate' || !pending.old) return 'pending';
  const check = await stkQuery(pending.checkout_request_id).catch(() => null);
  if (!check) return 'pending';
  if (check.resultCode === 0) {
    // Success without a callback: amount and receipt are unknown, so leave it
    // for the callback or an admin; the order page keeps showing "waiting".
    return 'pending';
  }
  return applyResult(
    {
      checkoutRequestId: pending.checkout_request_id,
      resultCode: check.resultCode,
      resultDesc: check.resultDesc,
      receipt: null,
      amount: null,
      phone: null,
    },
    { query: check },
    false,
  );
}

/** Simulate mode only: play the buyer's side of the STK prompt. */
export async function simulatePayment(userId: string, orderId: string, outcome: 'success' | 'cancel'): Promise<string> {
  if (mpesaMode !== 'simulate') return 'disabled';
  const [p] = await withUser(
    userId,
    (tx) => tx<{ checkout_request_id: string; amount_kes: number; phone: string }[]>`
    select p.checkout_request_id, p.amount_kes, p.phone
    from public.payments p join public.orders o on o.id = p.order_id
    where p.order_id = ${orderId} and p.status = 'requested' and o.buyer_id = ${userId}
    order by p.requested_at desc limit 1`,
  );
  if (!p) return 'none';
  const raw = simulatedCallback(p.checkout_request_id, p.amount_kes, p.phone, outcome);
  const cb = parseCallback(raw);
  return cb ? applyResult(cb, raw, false) : 'invalid';
}
