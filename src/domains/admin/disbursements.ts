import 'server-only';
import { getSql, withUser } from '@/lib/db';
import { disburse, fetchStatus, newReference, pesiMode, validateReceiver, type AccountType, type PesiResult } from '@/lib/pesi';
import type { Viewer } from '@/lib/auth/viewer';

// Money out through Pesi: farmer payouts (to the farm's saved payout account)
// and buyer refunds (back to the M-Pesa number that paid). The database
// reserves the amount while it is in flight and writes the ledger only when
// Pesi reports COMPLETED (record_disbursement_result).
//
// Ready for Admin → Money; the buttons come with the payouts step of the
// roadmap, once Switchlink has onboarded i12farm.

export interface PayoutAccount {
  channel: 'M' | 'B' | 'PAYBILL' | 'TILL';
  mobile: string | null;
  bank_code: string | null;
  bank_name: string | null;
  account_number: string | null;
  business_number: string | null;
  registered_name: string | null;
}

function accountType(a: PayoutAccount): { type: AccountType; number: string; bankCode?: string } {
  switch (a.channel) {
    case 'M':
      return { type: 'MB', number: a.mobile! };
    case 'B':
      return { type: 'BK', number: a.account_number!, bankCode: a.bank_code! };
    case 'PAYBILL':
      return { type: 'PL', number: a.business_number! };
    case 'TILL':
      return { type: 'TL', number: a.business_number! };
  }
}

/** Checks the receiver with Pesi ("Hakikisha") and saves where a farm wants its money. */
export async function savePayoutAccount(
  viewer: Viewer,
  farmId: string,
  input: Omit<PayoutAccount, 'registered_name' | 'bank_name'>,
): Promise<{ registeredName: string }> {
  const check = accountType({ ...input, registered_name: null, bank_name: null });
  const registeredName = await validateReceiver(check.type, check.number, check.bankCode);
  await getSql()`select public.set_farm_payout_account(${viewer.id}, ${farmId}, ${input.channel}, ${input.mobile},
                   ${input.bank_code}, ${input.account_number}, ${input.business_number}, ${registeredName})`;
  return { registeredName };
}

/** Admin: pay a farm what it is owed (or part of it) through Pesi. */
export async function startPayout(admin: Viewer, farmId: string, amount: number): Promise<{ reference: string; name: string }> {
  const [account] = await withUser(
    admin.id,
    (tx) => tx<PayoutAccount[]>`
    select a.channel, a.mobile, a.bank_code, b.name as bank_name, a.account_number, a.business_number, a.registered_name
    from public.farm_payout_accounts a left join public.pesi_banks b on b.code = a.bank_code
    where a.farm_id = ${farmId}`,
  );
  if (!account) throw new Error('This farm has not added where to send its money');
  const check = accountType(account);
  const name = await validateReceiver(check.type, check.number, check.bankCode); // checked again right before paying
  const reference = newReference('D');
  const receiver =
    account.channel === 'M'
      ? ({ channel: 'M', receiverName: name, mobile: account.mobile! } as const)
      : account.channel === 'B'
        ? ({
            channel: 'B',
            receiverName: name,
            bankName: account.bank_name!,
            bankCode: account.bank_code!,
            account: account.account_number!,
          } as const)
        : account.channel === 'PAYBILL'
          ? ({ channel: 'PAYBILL', receiverName: name, paybill: account.business_number!, account: account.account_number! } as const)
          : ({ channel: 'TILL', receiverName: name, till: account.business_number! } as const);
  await withUser(
    admin.id,
    (tx) => tx`select public.admin_start_disbursement('payout', ${farmId}, null, ${amount}, ${account.channel},
                 ${tx.json(receiver)}, ${name}, ${reference})`,
  );
  await send(reference, {
    ...receiver,
    amount,
    partnerTransactionId: reference,
    purpose: 'i12farm sales payout',
    remarks: 'i12farm payout',
  });
  return { reference, name };
}

/** Admin: refund a buyer to the M-Pesa number that paid for the order. */
export async function startRefund(admin: Viewer, orderId: string): Promise<{ reference: string; name: string; amount: number }> {
  const [o] = await withUser(
    admin.id,
    (tx) => tx<{ number: string; phone: string; due: number }[]>`
    select o.number,
           coalesce((select p.phone from public.payments p where p.order_id = o.id and p.status = 'succeeded'
                     order by p.completed_at desc limit 1), o.buyer_phone) as phone,
           r.due_kes::float8 as due
    from public.orders o join public.admin_refunds_due() r on r.order_id = o.id
    where o.id = ${orderId}`,
  );
  if (!o) throw new Error('Nothing to refund on this order');
  const name = await validateReceiver('MB', o.phone);
  const reference = newReference('D');
  const receiver = { channel: 'M', receiverName: name, mobile: o.phone } as const;
  await withUser(
    admin.id,
    (tx) =>
      tx`select public.admin_start_disbursement('refund', null, ${orderId}, ${o.due}, 'M', ${tx.json(receiver)}, ${name}, ${reference})`,
  );
  await send(reference, {
    ...receiver,
    amount: o.due,
    partnerTransactionId: reference,
    purpose: 'i12farm refund',
    remarks: `Refund ${o.number}`,
  });
  return { reference, name, amount: o.due };
}

async function send(reference: string, request: Parameters<typeof disburse>[0]) {
  try {
    await disburse(request);
  } catch (error) {
    // Pesi refused it: release the reserved amount so it can be tried again.
    await getSql()`select public.record_disbursement_result(${reference}, 'failed', 'NOT_SENT',
                     ${(error as Error).message.slice(0, 200)}, null, ${getSql().json({ error: (error as Error).message })})`;
    throw error;
  }
  if (pesiMode === 'simulate') {
    await getSql()`select public.record_disbursement_result(${reference}, 'completed', 'AC100', 'Simulated payout', ${'SIM-' + reference},
                     ${getSql().json({ simulated: true })})`;
  }
}

/** Pesi's answer for a payout or refund. `confirm` = check COMPLETED with Pesi first (callbacks are unsigned). */
export async function applyDisbursementResult(r: PesiResult, raw: unknown, confirm: boolean): Promise<string> {
  if (r.state === 'unknown') return 'unknown';
  if (r.state === 'completed' && confirm && pesiMode !== 'simulate') {
    const check = await fetchStatus(r.partnerTransactionId).catch(() => null);
    if (!check || check.state !== 'completed') return 'unconfirmed';
  }
  const sql = getSql();
  const [{ verdict }] = await sql<{ verdict: string }[]>`
    select public.record_disbursement_result(${r.partnerTransactionId}, ${r.state}, ${r.statusCode}, ${r.description},
                                             ${r.traceId}, ${sql.json(raw as never)}) as verdict`;
  return verdict;
}
