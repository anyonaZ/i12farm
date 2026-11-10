import 'server-only';
import { getSql, withUser } from '@/lib/db';
import {
  accountDetails,
  disburse,
  fetchStatus,
  newReference,
  pesiMode,
  validateReceiver,
  type AccountType,
  type Disbursement,
  type PesiResult,
} from '@/lib/pesi';
import type { Viewer } from '@/lib/auth/viewer';

// Money out through Pesi, in batches an admin approves (decision of 10 Nov 2026):
//   1. prepare: pick what is due (farmer payouts, buyer refunds); each
//      receiver's name is checked with Pesi ("Hakikisha"); the database
//      reserves the money in a draft batch. Nothing is sent.
//   2. review, take lines out or cancel the batch.
//   3. approve: the lines are sent to Pesi one by one.
//   4. Pesi's callbacks (or "Check with Pesi") complete or fail each line;
//      only COMPLETED reaches the ledger. Failed lines are due again.

export type Channel = 'M' | 'B' | 'PAYBILL' | 'TILL';

export interface PayoutAccountInput {
  channel: Channel;
  mobile: string | null;
  bank_code: string | null;
  account_number: string | null;
  business_number: string | null;
}

export interface PayoutAccount extends PayoutAccountInput {
  bank_name: string | null;
  registered_name: string | null;
  checked_at: string | null;
}

function lookup(a: PayoutAccountInput): { type: AccountType; number: string; bankCode?: string } {
  switch (a.channel) {
    case 'M':
      return { type: 'MB', number: a.mobile ?? '' };
    case 'B':
      return { type: 'BK', number: a.account_number ?? '', bankCode: a.bank_code ?? '' };
    case 'PAYBILL':
      return { type: 'PL', number: a.business_number ?? '' };
    case 'TILL':
      return { type: 'TL', number: a.business_number ?? '' };
  }
}

function toKePhone(raw: string | null): string | null {
  const d = (raw ?? '').replace(/\D/g, '');
  const m = d.match(/^(?:254|0)?([17]\d{8})$/);
  return m ? `254${m[1]}` : null;
}

// ---------------------------------------------------------------------------
// The farm's side: where its money goes
// ---------------------------------------------------------------------------

export async function getPayoutAccount(viewer: Viewer, farmId: string): Promise<PayoutAccount | null> {
  const [row] = await withUser(
    viewer.id,
    (tx) => tx<PayoutAccount[]>`
    select a.channel, a.mobile, a.bank_code, b.name as bank_name, a.account_number, a.business_number,
           a.registered_name, a.checked_at::text as checked_at
    from public.farm_payout_accounts a left join public.pesi_banks b on b.code = a.bank_code
    where a.farm_id = ${farmId}`,
  );
  return row ?? null;
}

export async function listBanks(): Promise<{ code: string; name: string }[]> {
  return withUser(null, (tx) => tx<{ code: string; name: string }[]>`select code, name from public.pesi_banks order by name`);
}

/** Checks the receiver with Pesi ("Hakikisha"), then saves where the farm wants its money. */
export async function savePayoutAccount(viewer: Viewer, farmId: string, input: PayoutAccountInput): Promise<{ registeredName: string }> {
  const clean: PayoutAccountInput = {
    channel: input.channel,
    mobile: input.channel === 'M' ? toKePhone(input.mobile) : null,
    bank_code: input.channel === 'B' ? input.bank_code : null,
    account_number: input.channel === 'B' || input.channel === 'PAYBILL' ? (input.account_number ?? '').trim() || null : null,
    business_number:
      input.channel === 'PAYBILL' || input.channel === 'TILL' ? (input.business_number ?? '').replace(/\D/g, '') || null : null,
  };
  if (clean.channel === 'M' && !clean.mobile) throw new Error('phone');
  if (clean.channel === 'B' && (!clean.bank_code || !clean.account_number)) throw new Error('bank');
  if ((clean.channel === 'PAYBILL' || clean.channel === 'TILL') && !/^\d{5,8}$/.test(clean.business_number ?? ''))
    throw new Error('business');
  if (clean.channel === 'PAYBILL' && !clean.account_number) throw new Error('account');
  const check = lookup(clean);
  const registeredName = await validateReceiver(check.type, check.number, check.bankCode);
  await getSql()`select public.set_farm_payout_account(${viewer.id}, ${farmId}, ${clean.channel}, ${clean.mobile},
                   ${clean.bank_code}, ${clean.account_number}, ${clean.business_number}, ${registeredName})`;
  return { registeredName };
}

export interface FarmPayout {
  id: string;
  kind: 'payout' | 'refund';
  amount_kes: number;
  fee_kes: number;
  status: string;
  status_description: string | null;
  requested_at: string;
  completed_at: string | null;
}

export async function farmPayouts(viewer: Viewer, farmId: string): Promise<FarmPayout[]> {
  return withUser(
    viewer.id,
    (tx) => tx<FarmPayout[]>`
    select id, kind, amount_kes::float8 as amount_kes, fee_kes::float8 as fee_kes, status, status_description,
           requested_at::text as requested_at, completed_at::text as completed_at
    from public.disbursements
    where farm_id = ${farmId} and kind = 'payout' and status <> 'cancelled'
    order by requested_at desc limit 20`,
  );
}

// ---------------------------------------------------------------------------
// The admin's side: batches
// ---------------------------------------------------------------------------

export interface Candidate {
  kind: 'payout' | 'refund';
  farm_id: string;
  order_id: string | null;
  order_number: string | null;
  name: string;
  due_kes: number;
  channel: Channel | null;
  mobile: string | null;
  bank_code: string | null;
  bank_name: string | null;
  account_number: string | null;
  business_number: string | null;
  registered_name: string | null;
  checked_at: string | null;
}

export async function payoutCandidates(admin: Viewer): Promise<Candidate[]> {
  return withUser(
    admin.id,
    (tx) => tx<Candidate[]>`
    select kind, farm_id, order_id, order_number, name, due_kes::float8 as due_kes, channel, mobile, bank_code, bank_name,
           account_number, business_number, registered_name, checked_at::text as checked_at
    from public.admin_payout_candidates()`,
  );
}

function receiverFor(c: Candidate, name: string): Disbursement {
  switch (c.channel) {
    case 'M':
      return { channel: 'M', receiverName: name, mobile: c.mobile! };
    case 'B':
      return { channel: 'B', receiverName: name, bankName: c.bank_name!, bankCode: c.bank_code!, account: c.account_number! };
    case 'PAYBILL':
      return { channel: 'PAYBILL', receiverName: name, paybill: c.business_number!, account: c.account_number! };
    case 'TILL':
      return { channel: 'TILL', receiverName: name, till: c.business_number! };
    default:
      throw new Error('no payout details');
  }
}

export interface Skipped {
  name: string;
  reason: string;
}

/**
 * Prepares a draft batch from the chosen candidates. Each receiver is checked
 * with Pesi now; lines that fail the check are left out and reported.
 */
export async function prepareBatch(
  admin: Viewer,
  picks: { kind: 'payout' | 'refund'; id: string; amount?: number }[],
  note: string,
): Promise<{ batchId: string | null; number: string | null; skipped: Skipped[] }> {
  const candidates = await payoutCandidates(admin);
  const skipped: Skipped[] = [];
  const lines: unknown[] = [];
  for (const pick of picks) {
    const c = candidates.find((x) => x.kind === pick.kind && (pick.kind === 'payout' ? x.farm_id === pick.id : x.order_id === pick.id));
    if (!c) {
      skipped.push({ name: pick.id, reason: 'nothing due' });
      continue;
    }
    const label = c.kind === 'refund' ? `#${c.order_number}` : c.name;
    if (!c.channel) {
      skipped.push({ name: label, reason: 'no payout details' });
      continue;
    }
    const amount = Math.min(pick.amount && pick.amount > 0 ? pick.amount : c.due_kes, c.due_kes);
    let checked: string;
    try {
      const l = lookup({ ...c, channel: c.channel });
      checked = await validateReceiver(l.type, l.number, l.bankCode);
    } catch (error) {
      skipped.push({ name: label, reason: (error as Error).message });
      continue;
    }
    lines.push({
      kind: c.kind,
      farm_id: c.kind === 'payout' ? c.farm_id : undefined,
      order_id: c.kind === 'refund' ? c.order_id : undefined,
      amount: Math.round(amount * 100) / 100,
      channel: c.channel,
      receiver: receiverFor(c, checked),
      validated_name: checked,
      reference: newReference('D'),
    });
  }
  if (!lines.length) return { batchId: null, number: null, skipped };
  const [b] = await withUser(
    admin.id,
    (tx) =>
      tx<{ id: string; number: string }[]>`select id, number from public.admin_create_payout_batch(${tx.json(lines as never)}, ${note})`,
  );
  return { batchId: b.id, number: b.number, skipped };
}

/** Approves a draft batch and sends every line to Pesi. Returns how many Pesi accepted. */
export async function approveAndSend(admin: Viewer, batchId: string): Promise<{ sent: number; refused: Skipped[] }> {
  const lines = await withUser(
    admin.id,
    (tx) => tx<{ partner_transaction_id: string; kind: string; amount_kes: string; fee_kes: string; receiver: Disbursement }[]>`
    select partner_transaction_id, kind, amount_kes, fee_kes, receiver from public.admin_approve_payout_batch(${batchId})`,
  );
  const [batch] = await withUser(
    admin.id,
    (tx) => tx<{ number: string }[]>`select number from public.payout_batches where id = ${batchId}`,
  );
  let sent = 0;
  const refused: Skipped[] = [];
  for (const line of lines) {
    const ref = line.partner_transaction_id;
    try {
      await disburse({
        ...line.receiver,
        // Farmers carry Pesi's charge: Pesi is sent the amount less the fee.
        amount: Number(line.amount_kes) - Number(line.fee_kes),
        partnerTransactionId: ref,
        purpose: line.kind === 'payout' ? 'i12farm sales payout' : 'i12farm refund',
        remarks: `i12farm ${batch?.number ?? ''} ${line.kind}`,
      });
      sent++;
      if (pesiMode === 'simulate') {
        await recordResult(
          {
            partnerTransactionId: ref,
            state: 'completed',
            statusCode: 'AC100',
            description: 'Simulated payout',
            traceId: `SIM-${ref}`,
            amount: null,
            receipt: null,
          },
          { simulated: true },
        );
      }
    } catch (error) {
      const reason = (error as Error).message;
      refused.push({ name: line.receiver.receiverName, reason });
      // Pesi refused it: the line fails and its money is due again.
      await recordResult(
        {
          partnerTransactionId: ref,
          state: 'failed',
          statusCode: 'NOT_SENT',
          description: reason.slice(0, 200),
          traceId: null,
          amount: null,
          receipt: null,
        },
        { error: reason },
      );
    }
  }
  return { sent, refused };
}

export async function removeLine(admin: Viewer, lineId: string) {
  await withUser(admin.id, (tx) => tx`select public.admin_remove_batch_line(${lineId})`);
}

export async function cancelBatch(admin: Viewer, batchId: string) {
  await withUser(admin.id, (tx) => tx`select public.admin_cancel_payout_batch(${batchId})`);
}

/** Asks Pesi about every line still on its way (when a callback seems lost). */
export async function checkBatch(admin: Viewer, batchId: string): Promise<{ checked: number; changed: number }> {
  const lines = await withUser(
    admin.id,
    (tx) => tx<{ partner_transaction_id: string }[]>`
    select partner_transaction_id from public.disbursements
    where batch_id = ${batchId} and status in ('requested', 'processing')`,
  );
  let changed = 0;
  for (const l of lines) {
    const r = await fetchStatus(l.partner_transaction_id).catch(() => null);
    if (!r || r.state === 'unknown') continue;
    const verdict = await recordResult(r, { query: r });
    if (verdict === 'completed' || verdict === 'failed') changed++;
  }
  return { checked: lines.length, changed };
}

async function recordResult(r: PesiResult, raw: unknown): Promise<string> {
  const sql = getSql();
  const [{ verdict }] = await sql<{ verdict: string }[]>`
    select public.record_disbursement_result(${r.partnerTransactionId}, ${r.state}, ${r.statusCode}, ${r.description},
                                             ${r.traceId}, ${sql.json(raw as never)}) as verdict`;
  return verdict;
}

/** Pesi's callback for a payout or refund. `confirm` = check COMPLETED with Pesi first (callbacks are unsigned). */
export async function applyDisbursementResult(r: PesiResult, raw: unknown, confirm: boolean): Promise<string> {
  if (r.state === 'unknown') return 'unknown';
  if (r.state === 'completed' && confirm && pesiMode !== 'simulate') {
    const check = await fetchStatus(r.partnerTransactionId).catch(() => null);
    if (!check || check.state !== 'completed') return 'unconfirmed';
  }
  return recordResult(r, raw);
}

export interface BatchSummary {
  id: string;
  number: string;
  status: 'draft' | 'sending' | 'done' | 'cancelled';
  note: string | null;
  created_at: string;
  created_by_name: string | null;
  approved_at: string | null;
  approved_by_name: string | null;
  lines: number;
  total_kes: number;
  fees_kes: number;
  completed_kes: number;
  failed: number;
  in_flight: number;
}

export async function listBatches(admin: Viewer): Promise<BatchSummary[]> {
  return withUser(
    admin.id,
    (tx) => tx<BatchSummary[]>`
    select b.id, b.number, b.status, b.note, b.created_at::text as created_at, pc.full_name as created_by_name,
           b.approved_at::text as approved_at, pa.full_name as approved_by_name,
           count(d.id) filter (where d.status <> 'cancelled')::int as lines,
           coalesce(sum(d.amount_kes) filter (where d.status <> 'cancelled'), 0)::float8 as total_kes,
           coalesce(sum(d.fee_kes) filter (where d.status <> 'cancelled'), 0)::float8 as fees_kes,
           coalesce(sum(d.amount_kes) filter (where d.status = 'completed'), 0)::float8 as completed_kes,
           count(d.id) filter (where d.status = 'failed')::int as failed,
           count(d.id) filter (where d.status in ('requested', 'processing'))::int as in_flight
    from public.payout_batches b
    left join public.disbursements d on d.batch_id = b.id
    left join public.profiles pc on pc.id = b.created_by
    left join public.profiles pa on pa.id = b.approved_by
    group by b.id, pc.full_name, pa.full_name
    order by b.created_at desc limit 50`,
  );
}

export interface BatchLine {
  id: string;
  kind: 'payout' | 'refund';
  farm_name: string;
  order_number: string | null;
  amount_kes: number;
  fee_kes: number;
  channel: Channel;
  receiver: Disbursement;
  validated_name: string | null;
  saved_name: string | null;
  status: string;
  status_description: string | null;
  trace_id: string | null;
  requested_at: string;
  completed_at: string | null;
}

export async function getBatch(admin: Viewer, id: string): Promise<{ batch: BatchSummary; lines: BatchLine[] } | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const batch = (await listBatches(admin)).find((b) => b.id === id);
  if (!batch) return null;
  const lines = await withUser(
    admin.id,
    (tx) => tx<BatchLine[]>`
    select d.id, d.kind, f.name as farm_name, o.number as order_number, d.amount_kes::float8 as amount_kes, d.fee_kes::float8 as fee_kes, d.channel, d.receiver,
           d.validated_name, a.registered_name as saved_name, d.status, d.status_description, d.trace_id,
           d.requested_at::text as requested_at, d.completed_at::text as completed_at
    from public.disbursements d
    join public.farms f on f.id = d.farm_id
    left join public.orders o on o.id = d.order_id
    left join public.farm_payout_accounts a on a.farm_id = d.farm_id and d.kind = 'payout'
    where d.batch_id = ${id}
    order by d.kind, d.amount_kes desc`,
  );
  return { batch, lines };
}

/** The Pesi account balance (empty in simulate mode). Never throws. */
export async function pesiBalance(): Promise<{ accounts: { name: string; number: string; balance: number }[]; error: string | null }> {
  try {
    const rows = await accountDetails();
    return {
      accounts: rows.map((r) => ({ name: r.accountName, number: r.accountNumber, balance: Number(r.accountBalance) })),
      error: null,
    };
  } catch (error) {
    return { accounts: [], error: (error as Error).message };
  }
}
