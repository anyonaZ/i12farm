import 'server-only';
import { getSql, withUser } from '@/lib/db';
import { fetchStatus, newReference, pesiMode, simulatedCallback, stkPush, parseCallback, type PesiResult } from '@/lib/pesi';
import { recordEvent } from '@/lib/analytics/server';

// Payment orchestration: ask Pesi to send the buyer an M-Pesa prompt, then
// record the result exactly once. The database function record_payment_result()
// holds the money rules (amount check, ledger rows, stock); this file only
// talks to Pesi and passes results along.
//
// payments.checkout_request_id holds our Pesi reference (I12P…).

export type PayError = 'notYours' | 'notPayable' | 'mpesa';

export async function requestPayment(
  userId: string,
  orderId: string,
  phone?: string | null,
): Promise<{ ok: true; reference: string; message: string } | { ok: false; error: PayError; detail?: string }> {
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
  if (order.recent) return { ok: true, reference: order.recent, message: 'pending' };

  const payPhone = phone ?? order.buyer_phone;
  const amount = Math.round(order.subtotal_kes);
  const reference = newReference('P');
  // Record first, so a callback that arrives quickly always finds the payment.
  const sql = getSql();
  await sql`select public.record_payment_request(${order.id}, ${payPhone}, ${amount}, ${'pesi'}, ${reference}, ${userId})`;
  let stk;
  try {
    stk = await stkPush({ phone: payPhone, amount, partnerReference: reference });
  } catch (error) {
    await markNotSent(reference, (error as Error).message);
    return { ok: false, error: 'mpesa', detail: (error as Error).message };
  }
  await withUser(userId, (tx) =>
    recordEvent(tx, { name: 'payment.requested', userId, properties: { order: order.id, amount, mode: pesiMode }, path: '/orders' }),
  );
  return { ok: true, reference, message: stk.message };
}

/** Pesi refused the request: close the payment row so the buyer can try again at once. */
async function markNotSent(reference: string, detail: string) {
  await getSql()`select public.record_payment_result(${reference}, ${-1}, ${'Not sent: ' + detail.slice(0, 200)}, null, null, ${getSql().json({ error: detail })})`.catch(
    () => undefined,
  );
}

/** Pesi state → the result code record_payment_result() understands (0 = paid; 1032 cancelled; 1037 timed out). */
function resultCode(r: PesiResult): number {
  if (r.state === 'completed') return 0;
  if (/cancel/i.test(r.description)) return 1032;
  if (/time ?out|timed out|expired|no response|unreachable/i.test(r.description)) return 1037;
  return 1;
}

/**
 * Apply a Pesi result for a collection. `confirm` = check COMPLETED with Pesi
 * first (used for callbacks, which are unsigned). Returns the database verdict.
 */
export async function applyResult(r: PesiResult, raw: unknown, confirm: boolean): Promise<string> {
  if (r.state === 'processing' || r.state === 'unknown') return 'pending';
  let result = r;
  if (r.state === 'completed' && confirm && pesiMode !== 'simulate') {
    const check = await fetchStatus(r.partnerTransactionId).catch(() => null);
    if (!check || check.state !== 'completed') {
      console.warn('Pesi callback not confirmed by status query', r.partnerTransactionId);
      return 'unconfirmed';
    }
    result = { ...r, amount: r.amount ?? check.amount, receipt: r.receipt ?? check.receipt, traceId: r.traceId ?? check.traceId };
  }
  const sql = getSql();
  // Pesi's callback carries no amount. An STK prompt is for a fixed amount, so
  // when Pesi doesn't say otherwise the requested amount is what was paid.
  const [payment] = await sql<{ amount_kes: number }[]>`
    select amount_kes from public.payments where checkout_request_id = ${result.partnerTransactionId}`;
  if (!payment) return 'unknown';
  const amount = result.state === 'completed' ? (result.amount ?? payment.amount_kes) : null;
  const receipt = result.state === 'completed' ? (result.receipt ?? result.traceId) : null;
  const [{ verdict }] = await sql<{ verdict: string }[]>`
    select public.record_payment_result(${result.partnerTransactionId}, ${resultCode(result)},
             ${result.description || result.statusCode}, ${receipt}, ${amount}, ${sql.json(raw as never)}) as verdict`;
  if (verdict === 'paid' || verdict === 'failed' || verdict === 'paid_after_cancel' || verdict === 'underpaid') {
    const [p] = await sql<{ order_id: string | null; promotion_id: string | null }[]>`
      select order_id, promotion_id from public.payments where checkout_request_id = ${result.partnerTransactionId}`;
    await sql`
      insert into public.events (name, anonymous_id, properties, path)
      values (${verdict === 'failed' ? 'payment.failed' : 'payment.succeeded'}, 'server',
              ${sql.json({ order: p?.order_id ?? null, promotion: p?.promotion_id ?? null, result: verdict, code: result.statusCode })},
              '/api/pesi/callback')`;
  }
  return verdict;
}

/** For a prompt that got no callback (phone off, callback lost): ask Pesi directly. */
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
  if (pesiMode === 'simulate' || !pending.old) return 'pending';
  const check = await fetchStatus(pending.checkout_request_id).catch(() => null);
  if (!check) return 'pending';
  return applyResult(check, { query: check }, false);
}

async function simulateFor(reference: string | undefined, outcome: 'success' | 'cancel'): Promise<string> {
  if (!reference) return 'none';
  const raw = simulatedCallback(reference, outcome);
  const r = parseCallback(raw);
  return r ? applyResult(r, raw, false) : 'invalid';
}

/** Simulate mode only: play the buyer's side of the M-Pesa prompt. */
export async function simulatePayment(userId: string, orderId: string, outcome: 'success' | 'cancel'): Promise<string> {
  if (pesiMode !== 'simulate') return 'disabled';
  const [p] = await withUser(
    userId,
    (tx) => tx<{ checkout_request_id: string }[]>`
    select p.checkout_request_id
    from public.payments p join public.orders o on o.id = p.order_id
    where p.order_id = ${orderId} and p.status = 'requested' and o.buyer_id = ${userId}
    order by p.requested_at desc limit 1`,
  );
  return simulateFor(p?.checkout_request_id, outcome);
}

// ---------------------------------------------------------------------------
// Featured listings: the farm pays, same flow, different target.
// ---------------------------------------------------------------------------
export async function requestPromotionPayment(
  userId: string,
  promotionId: string,
  phone: string,
): Promise<{ ok: true; message: string } | { ok: false; error: PayError; detail?: string }> {
  const promo = await withUser(userId, async (tx) => {
    const [row] = await tx<{ id: string; status: string; amount_kes: number; days: number; farm_id: string; recent: string | null }[]>`
      select p.id, p.status, p.amount_kes, p.days, p.farm_id,
             (select x.checkout_request_id from public.payments x
               where x.promotion_id = p.id and x.status = 'requested' and x.requested_at > now() - interval '90 seconds'
               order by x.requested_at desc limit 1) as recent
      from public.farm_promotions p where p.id = ${promotionId}`;
    return row;
  });
  if (!promo) return { ok: false, error: 'notYours' };
  if (promo.status !== 'awaiting_payment') return { ok: false, error: 'notPayable' };
  if (promo.recent) return { ok: true, message: 'pending' };
  const reference = newReference('P');
  await getSql()`select public.record_promotion_payment_request(${promo.id}, ${phone}, ${promo.amount_kes},
                   ${'pesi'}, ${reference}, ${userId})`;
  let stk;
  try {
    stk = await stkPush({ phone, amount: promo.amount_kes, partnerReference: reference });
  } catch (error) {
    await markNotSent(reference, (error as Error).message);
    return { ok: false, error: 'mpesa', detail: (error as Error).message };
  }
  await withUser(userId, (tx) =>
    recordEvent(tx, {
      name: 'payment.requested',
      userId,
      properties: { promotion: promo.id, farm: promo.farm_id, amount: promo.amount_kes, mode: pesiMode },
      path: '/my-farm/promote',
    }),
  );
  return { ok: true, message: stk.message };
}

/** Simulate mode only: answer the prompt for a featured-listing payment. */
export async function simulatePromotionPayment(userId: string, promotionId: string, outcome: 'success' | 'cancel'): Promise<string> {
  if (pesiMode !== 'simulate') return 'disabled';
  const [p] = await withUser(
    userId,
    (tx) => tx<{ checkout_request_id: string }[]>`
    select x.checkout_request_id
    from public.payments x join public.farm_promotions p on p.id = x.promotion_id
    where x.promotion_id = ${promotionId} and x.status = 'requested'
    order by x.requested_at desc limit 1`,
  );
  return simulateFor(p?.checkout_request_id, outcome);
}
