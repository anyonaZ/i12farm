-- i12farm · Pesi charges carried by farmers (decision of 10 Nov 2026)
-- Farmers carry Pesi's costs on their own money:
--   * collection fee: what Pesi charges to collect a buyer's M-Pesa payment,
--     snapshotted on the order when it is paid and taken from the farmer's
--     share when the order completes;
--   * payout fee: what Pesi charges to send the farmer's money (depends on
--     M-Pesa / bank / paybill / till), taken from the payout.
-- i12farm's commission (commission_bps, 10% by default) stays as it was.
-- Refund transfers are carried by i12farm (the buyer gets everything back).
--
-- The amounts are settings (Admin → Settings → Pesi charges), all 0 until
-- Switchlink confirms its price list. A fee rule is
--   {"percent": 0, "bands": [{"upto": 1000, "fee": 15}, {"upto": 5000, "fee": 25}, {"upto": null, "fee": 40}]}
-- fee = the first band whose "upto" covers the amount (null = no limit) + percent of the amount.
--
-- Ledger: the balance formulas do not change. Completion now records
-- payout_due = farmer share − collection fee, plus a memo row
-- 'collection_fee'; a paid-out line records payout_sent = net sent + fee and a
-- memo row 'payout_fee'. 'pesi_cost' records Pesi charges i12farm carries.

insert into public.platform_settings (key, value, note) values
  ('pesi_collection_fee', '{"percent": 0, "bands": []}',
   'Pesi charge for collecting a buyer''s payment, taken from the farmer''s share. Fill in from Switchlink''s price list.'),
  ('pesi_payout_fees',
   '{"M": {"percent": 0, "bands": []}, "B": {"percent": 0, "bands": []}, "PAYBILL": {"percent": 0, "bands": []}, "TILL": {"percent": 0, "bands": []}}',
   'Pesi charge for sending a payout, by channel, taken from the payout. Fill in from Switchlink''s price list.')
on conflict (key) do nothing;

create or replace function public.fee_for(rule jsonb, amount numeric)
returns numeric
language sql
immutable
as $$
  select round(
           coalesce((select (b ->> 'fee')::numeric
                       from jsonb_array_elements(coalesce(rule -> 'bands', '[]'::jsonb)) with ordinality as x(b, n)
                      where b ->> 'upto' is null or amount <= (b ->> 'upto')::numeric
                      order by n limit 1), 0)
           + amount * coalesce((rule ->> 'percent')::numeric, 0) / 100, 2);
$$;

-- Checks the shape when an admin saves a fee rule.
create or replace function public.valid_fee_rule(rule jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(rule) = 'object'
     and coalesce((rule ->> 'percent')::numeric, 0) between 0 and 10
     and jsonb_typeof(coalesce(rule -> 'bands', '[]'::jsonb)) = 'array'
     and not exists (select 1 from jsonb_array_elements(coalesce(rule -> 'bands', '[]'::jsonb)) b
                      where jsonb_typeof(b) <> 'object'
                         or coalesce((b ->> 'fee')::numeric, -1) not between 0 and 5000
                         or (b ->> 'upto' is not null and (b ->> 'upto')::numeric <= 0));
$$;

create or replace function public.admin_set_setting(k text, v jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  if k = 'commission_bps' and ((v #>> '{}')::integer not between 0 and 3000) then
    raise exception 'Commission must be between 0 and 30%%' using errcode = '22023';
  end if;
  if k = 'pesi_collection_fee' and not public.valid_fee_rule(v) then
    raise exception 'Fee rule not valid (fees 0–5,000 KES, percent 0–10)' using errcode = '22023';
  end if;
  if k = 'pesi_payout_fees' and (jsonb_typeof(v) <> 'object'
       or exists (select 1 from jsonb_each(v) e where e.key not in ('M', 'B', 'PAYBILL', 'TILL') or not public.valid_fee_rule(e.value))) then
    raise exception 'Fee rules not valid (M, B, PAYBILL, TILL; fees 0–5,000 KES, percent 0–10)' using errcode = '22023';
  end if;
  insert into public.platform_settings (key, value, updated_by) values (k, v, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
end;
$$;
revoke execute on function public.admin_set_setting(text, jsonb) from public, anon;

alter table public.ledger_entries drop constraint ledger_entries_kind_check;
alter table public.ledger_entries add constraint ledger_entries_kind_check check (kind in (
  'buyer_payment', 'commission', 'farmer_payable', 'payout_due', 'payout_sent', 'refund_due', 'refund_sent',
  'promotion_fee',
  'collection_fee',   -- memo: Pesi's charge for collecting the buyer's payment, carried by the farm
  'payout_fee',       -- memo: Pesi's charge for sending the farm's payout, carried by the farm
  'pesi_cost'));      -- memo: Pesi charges i12farm carries (refund transfers)

-- The collection fee is fixed when the order is paid.
alter table public.orders add column collection_fee_kes numeric(12, 2) not null default 0 check (collection_fee_kes >= 0);

create or replace function public.orders_snapshot_collection_fee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'paid' and old.status = 'awaiting_payment' then
    new.collection_fee_kes := least(public.fee_for(
      coalesce((select value from public.platform_settings where key = 'pesi_collection_fee'), '{}'), new.subtotal_kes),
      new.farmer_payout_kes);
  end if;
  return new;
end;
$$;
create trigger orders_snapshot_collection_fee
  before update of status on public.orders
  for each row execute function public.orders_snapshot_collection_fee();

-- Completion: the farmer is owed their share minus the collection fee.
create or replace function public.apply_order_status(oid uuid, to_status public.order_status, note text, actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
begin
  select * into o from public.orders x where x.id = oid for update;
  perform set_config('i12farm.status_note', coalesce(left(note, 500), ''), true);
  update public.orders x
     set status = to_status,
         completed_at = case when to_status = 'completed' then now() else x.completed_at end,
         cancelled_at = case when to_status in ('cancelled', 'declined') then now() else x.cancelled_at end
   where x.id = oid;
  perform set_config('i12farm.status_note', '', true);

  if to_status = 'completed' then
    insert into public.ledger_entries (order_id, farm_id, kind, amount_kes, actor_id)
    values (oid, o.farm_id, 'payout_due', o.farmer_payout_kes - o.collection_fee_kes, actor);
    if o.collection_fee_kes > 0 then
      insert into public.ledger_entries (order_id, farm_id, kind, amount_kes, reference, actor_id)
      values (oid, o.farm_id, 'collection_fee', o.collection_fee_kes, 'Pesi collection charge', actor);
    end if;
  elsif to_status in ('cancelled', 'declined') and o.paid_at is not null then
    insert into public.ledger_entries (order_id, farm_id, kind, amount_kes, actor_id)
    values (oid, o.farm_id, 'refund_due', o.subtotal_kes, actor);
  end if;
end;
$$;
revoke execute on function public.apply_order_status(uuid, public.order_status, text, uuid) from public, anon, authenticated;

-- Payout lines carry their fee; Pesi is sent amount − fee.
alter table public.disbursements add column fee_kes numeric(12, 2) not null default 0 check (fee_kes >= 0);
alter table public.disbursements add constraint disbursements_fee_below_amount check (fee_kes < amount_kes);
comment on column public.disbursements.amount_kes is 'Taken from what is due (gross). Pesi is sent amount_kes − fee_kes for payouts; refunds are sent in full';

-- Draft batch lines: the fee is worked out here from the settings.
create or replace function public.admin_create_payout_batch(p_lines jsonb, p_note text default null)
returns public.payout_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  b       public.payout_batches;
  line    jsonb;
  k       text;
  fid     uuid;
  oid     uuid;
  amt     numeric;
  due     numeric;
  flying  numeric;
  fee     numeric;
  rules   jsonb := coalesce((select value from public.platform_settings where key = 'pesi_payout_fees'), '{}');
begin
  perform public.require_admin();
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Choose at least one payout or refund' using errcode = '22023';
  end if;
  insert into public.payout_batches (note, created_by) values (nullif(trim(p_note), ''), auth.uid()) returning * into b;
  for line in select * from jsonb_array_elements(p_lines) loop
    k := line ->> 'kind';
    amt := (line ->> 'amount')::numeric;
    if k = 'payout' then
      fid := (line ->> 'farm_id')::uuid;
      oid := null;
      select coalesce(sum(amount_kes) filter (where kind = 'payout_due'), 0) - coalesce(sum(amount_kes) filter (where kind = 'payout_sent'), 0)
        into due from public.ledger_entries where farm_id = fid;
      select coalesce(sum(amount_kes), 0) into flying from public.disbursements d
       where d.farm_id = fid and d.kind = 'payout' and d.status in ('queued', 'requested', 'processing');
      fee := public.fee_for(coalesce(rules -> (line ->> 'channel'), '{}'), amt);
    elsif k = 'refund' then
      oid := (line ->> 'order_id')::uuid;
      select o.farm_id into fid from public.orders o where o.id = oid;
      select coalesce(sum(amount_kes) filter (where kind = 'refund_due'), 0) - coalesce(sum(amount_kes) filter (where kind = 'refund_sent'), 0)
        into due from public.ledger_entries where order_id = oid;
      select coalesce(sum(amount_kes), 0) into flying from public.disbursements d
       where d.order_id = oid and d.kind = 'refund' and d.status in ('queued', 'requested', 'processing');
      fee := 0;   -- buyers get everything back; i12farm carries the transfer charge
    else
      raise exception 'Unknown kind %', k using errcode = '22023';
    end if;
    if fid is null or amt is null or amt <= 0 or amt > due - coalesce(flying, 0) then
      raise exception 'Amount must be between 1 and the KES % still due', greatest(due - coalesce(flying, 0), 0) using errcode = '22023';
    end if;
    if fee >= amt then
      raise exception 'KES % is less than Pesi''s charge of KES %; wait until more is due', amt, fee using errcode = '22023';
    end if;
    insert into public.disbursements
      (partner_transaction_id, kind, farm_id, order_id, amount_kes, fee_kes, channel, receiver, validated_name, requested_by, batch_id, status)
    values (line ->> 'reference', k, fid, oid, amt, fee, line ->> 'channel', coalesce(line -> 'receiver', '{}'),
            nullif(trim(line ->> 'validated_name'), ''), auth.uid(), b.id, 'queued');
  end loop;
  insert into auth.audit_log (actor_id, action, details)
  values (auth.uid(), 'payout_batch.create', jsonb_build_object('batch', b.number, 'lines', jsonb_array_length(p_lines)));
  return b;
end;
$$;
revoke execute on function public.admin_create_payout_batch(jsonb, text) from public, anon;
grant execute on function public.admin_create_payout_batch(jsonb, text) to authenticated;

-- A completed payout settles the gross amount; the fee is shown as its own memo row.
create or replace function public.record_disbursement_result(
  p_partner_id text, p_state text, p_code text, p_descr text, p_trace text, p_raw jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  d       public.disbursements;
  verdict text;
  ref     text;
  rules   jsonb := coalesce((select value from public.platform_settings where key = 'pesi_payout_fees'), '{}');
begin
  select * into d from public.disbursements x where x.partner_transaction_id = p_partner_id for update;
  if not found or d.status in ('queued', 'cancelled') then
    return 'unknown';
  end if;
  if d.status in ('completed', 'failed') then
    return 'already_final';
  end if;
  ref := 'Pesi ' || coalesce(p_trace, d.partner_transaction_id);
  if p_state = 'processing' then
    update public.disbursements x set status = 'processing', status_code = p_code, status_description = p_descr,
           trace_id = coalesce(p_trace, x.trace_id), callback = p_raw
     where x.id = d.id;
    return 'processing';
  elsif p_state = 'completed' then
    update public.disbursements x set status = 'completed', status_code = p_code, status_description = p_descr,
           trace_id = coalesce(p_trace, x.trace_id), callback = p_raw, completed_at = now()
     where x.id = d.id;
    insert into public.ledger_entries (order_id, farm_id, kind, amount_kes, reference, actor_id)
    values (d.order_id, d.farm_id, case when d.kind = 'payout' then 'payout_sent' else 'refund_sent' end, d.amount_kes, ref, d.requested_by);
    if d.kind = 'payout' and d.fee_kes > 0 then
      insert into public.ledger_entries (farm_id, kind, amount_kes, reference, actor_id)
      values (d.farm_id, 'payout_fee', d.fee_kes, ref, d.requested_by);
    elsif d.kind = 'refund' then
      -- what Pesi charges i12farm for the refund transfer (memo; 0 until fees are set)
      if public.fee_for(coalesce(rules -> d.channel, '{}'), d.amount_kes) > 0 then
        insert into public.ledger_entries (order_id, farm_id, kind, amount_kes, reference, actor_id)
        values (d.order_id, d.farm_id, 'pesi_cost', public.fee_for(coalesce(rules -> d.channel, '{}'), d.amount_kes), ref, d.requested_by);
      end if;
    end if;
    verdict := 'completed';
  elsif p_state = 'failed' then
    update public.disbursements x set status = 'failed', status_code = p_code, status_description = p_descr,
           trace_id = coalesce(p_trace, x.trace_id), callback = p_raw, completed_at = now()
     where x.id = d.id;
    verdict := 'failed';
  else
    return 'unknown';
  end if;
  if d.batch_id is not null and not exists (
       select 1 from public.disbursements x where x.batch_id = d.batch_id and x.status in ('queued', 'requested', 'processing')) then
    update public.payout_batches b set status = 'done', closed_at = now() where b.id = d.batch_id and b.status = 'sending';
  end if;
  return verdict;
end;
$$;
revoke execute on function public.record_disbursement_result(text, text, text, text, text, jsonb) from public, anon, authenticated;
