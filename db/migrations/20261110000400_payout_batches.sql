-- i12farm · Payouts in batches (decision of 10 Nov 2026)
-- Money goes out through Pesi only in batches an admin approves: the admin
-- prepares a batch (farmer payouts and buyer refunds that are due, each
-- receiver's name checked with Pesi), reviews it, then approves it, and only
-- then is anything sent. Lines that fail go back to "due" for the next batch.

create sequence public.payout_batch_seq start 1001;

create table public.payout_batches (
  id           uuid primary key default gen_random_uuid(),
  number       text not null unique default ('P' || nextval('public.payout_batch_seq')::text),
  status       text not null default 'draft' check (status in ('draft', 'sending', 'done', 'cancelled')),
  note         text check (char_length(note) <= 300),
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  approved_by  uuid references public.profiles (id) on delete set null,
  approved_at  timestamptz,
  closed_at    timestamptz
);
alter table public.payout_batches enable row level security;
revoke insert, update, delete on public.payout_batches from anon, authenticated;
create policy "batches to admins" on public.payout_batches for select to authenticated using (public.has_role('admin'));

-- Lines of a batch are disbursements. 'queued' = in a draft batch (money
-- reserved, nothing sent); 'cancelled' = taken out before sending.
alter table public.disbursements add column batch_id uuid references public.payout_batches (id);
create index disbursements_batch_idx on public.disbursements (batch_id);
alter table public.disbursements drop constraint disbursements_status_check;
alter table public.disbursements add constraint disbursements_status_check
  check (status in ('queued', 'requested', 'processing', 'completed', 'failed', 'cancelled'));
alter table public.disbursements alter column status set default 'queued';

-- Single payouts outside a batch are no longer allowed.
drop function if exists public.admin_start_disbursement(text, uuid, uuid, numeric, text, jsonb, text, text);

-- What is due and not already in a batch or on its way.
create or replace function public.admin_payout_candidates()
returns table (
  kind text, farm_id uuid, order_id uuid, order_number text, name text, due_kes numeric,
  channel text, mobile text, bank_code text, bank_name text, account_number text, business_number text,
  registered_name text, checked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return query
    with farm_due as (
      select e.farm_id,
             coalesce(sum(e.amount_kes) filter (where e.kind = 'payout_due'), 0)
               - coalesce(sum(e.amount_kes) filter (where e.kind = 'payout_sent'), 0) as due
      from public.ledger_entries e group by e.farm_id
    ),
    farm_flying as (
      select d.farm_id, sum(d.amount_kes) as flying from public.disbursements d
      where d.kind = 'payout' and d.status in ('queued', 'requested', 'processing') group by d.farm_id
    ),
    order_due as (
      select e.order_id,
             coalesce(sum(e.amount_kes) filter (where e.kind = 'refund_due'), 0)
               - coalesce(sum(e.amount_kes) filter (where e.kind = 'refund_sent'), 0) as due
      from public.ledger_entries e where e.order_id is not null group by e.order_id
    ),
    order_flying as (
      select d.order_id, sum(d.amount_kes) as flying from public.disbursements d
      where d.kind = 'refund' and d.status in ('queued', 'requested', 'processing') group by d.order_id
    )
    select 'payout'::text, f.id, null::uuid, null::text, f.name, fd.due - coalesce(ff.flying, 0),
           a.channel, a.mobile, a.bank_code, b.name, a.account_number, a.business_number, a.registered_name, a.checked_at
    from farm_due fd
    join public.farms f on f.id = fd.farm_id
    left join farm_flying ff on ff.farm_id = fd.farm_id
    left join public.farm_payout_accounts a on a.farm_id = f.id
    left join public.pesi_banks b on b.code = a.bank_code
    where fd.due - coalesce(ff.flying, 0) > 0
    union all
    select 'refund', o.farm_id, o.id, o.number, coalesce(o.buyer_name, 'Buyer'), od.due - coalesce(ofl.flying, 0),
           'M', coalesce((select p.phone from public.payments p where p.order_id = o.id and p.status = 'succeeded'
                          order by p.completed_at desc limit 1), o.buyer_phone),
           null, null, null, null, null, null
    from order_due od
    join public.orders o on o.id = od.order_id
    left join order_flying ofl on ofl.order_id = od.order_id
    where od.due - coalesce(ofl.flying, 0) > 0
    order by 1, 6 desc;
end;
$$;
revoke execute on function public.admin_payout_candidates() from public, anon;
grant execute on function public.admin_payout_candidates() to authenticated;

-- Prepare a draft batch. lines: [{kind, farm_id | order_id, amount, channel, receiver, validated_name, reference}]
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
    elsif k = 'refund' then
      oid := (line ->> 'order_id')::uuid;
      select o.farm_id into fid from public.orders o where o.id = oid;
      select coalesce(sum(amount_kes) filter (where kind = 'refund_due'), 0) - coalesce(sum(amount_kes) filter (where kind = 'refund_sent'), 0)
        into due from public.ledger_entries where order_id = oid;
      select coalesce(sum(amount_kes), 0) into flying from public.disbursements d
       where d.order_id = oid and d.kind = 'refund' and d.status in ('queued', 'requested', 'processing');
    else
      raise exception 'Unknown kind %', k using errcode = '22023';
    end if;
    if fid is null or amt is null or amt <= 0 or amt > due - coalesce(flying, 0) then
      raise exception 'Amount must be between 1 and the KES % still due', greatest(due - coalesce(flying, 0), 0) using errcode = '22023';
    end if;
    insert into public.disbursements
      (partner_transaction_id, kind, farm_id, order_id, amount_kes, channel, receiver, validated_name, requested_by, batch_id, status)
    values (line ->> 'reference', k, fid, oid, amt, line ->> 'channel', coalesce(line -> 'receiver', '{}'),
            nullif(trim(line ->> 'validated_name'), ''), auth.uid(), b.id, 'queued');
  end loop;
  insert into auth.audit_log (actor_id, action, details)
  values (auth.uid(), 'payout_batch.create', jsonb_build_object('batch', b.number, 'lines', jsonb_array_length(p_lines)));
  return b;
end;
$$;
revoke execute on function public.admin_create_payout_batch(jsonb, text) from public, anon;
grant execute on function public.admin_create_payout_batch(jsonb, text) to authenticated;

-- Take one line out of a draft batch (its money is free again).
create or replace function public.admin_remove_batch_line(p_line uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  update public.disbursements d set status = 'cancelled', completed_at = now()
   where d.id = p_line and d.status = 'queued'
     and exists (select 1 from public.payout_batches b where b.id = d.batch_id and b.status = 'draft');
  if not found then
    raise exception 'Only lines of a batch that has not been sent can be removed' using errcode = '55000';
  end if;
end;
$$;
revoke execute on function public.admin_remove_batch_line(uuid) from public, anon;
grant execute on function public.admin_remove_batch_line(uuid) to authenticated;

create or replace function public.admin_cancel_payout_batch(p_batch uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  update public.payout_batches b set status = 'cancelled', closed_at = now() where b.id = p_batch and b.status = 'draft';
  if not found then
    raise exception 'Only a batch that has not been sent can be cancelled' using errcode = '55000';
  end if;
  update public.disbursements d set status = 'cancelled', completed_at = now() where d.batch_id = p_batch and d.status = 'queued';
  insert into auth.audit_log (actor_id, action, details) values (auth.uid(), 'payout_batch.cancel', jsonb_build_object('batch', p_batch));
end;
$$;
revoke execute on function public.admin_cancel_payout_batch(uuid) from public, anon;
grant execute on function public.admin_cancel_payout_batch(uuid) to authenticated;

-- Approve: the batch's lines become 'requested' and the server sends them to Pesi.
-- Returns the lines to send.
create or replace function public.admin_approve_payout_batch(p_batch uuid)
returns setof public.disbursements
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.payout_batches;
begin
  perform public.require_admin();
  select * into b from public.payout_batches x where x.id = p_batch for update;
  if not found or b.status <> 'draft' then
    raise exception 'This batch is not waiting for approval' using errcode = '55000';
  end if;
  if not exists (select 1 from public.disbursements d where d.batch_id = p_batch and d.status = 'queued') then
    raise exception 'This batch has nothing left to send' using errcode = '55000';
  end if;
  update public.payout_batches x set status = 'sending', approved_by = auth.uid(), approved_at = now() where x.id = p_batch;
  insert into auth.audit_log (actor_id, action, details)
  values (auth.uid(), 'payout_batch.approve',
          jsonb_build_object('batch', b.number,
                             'total', (select sum(amount_kes) from public.disbursements where batch_id = p_batch and status = 'queued')));
  return query
    update public.disbursements d set status = 'requested', requested_at = now()
     where d.batch_id = p_batch and d.status = 'queued'
    returning d.*;
end;
$$;
revoke execute on function public.admin_approve_payout_batch(uuid) from public, anon;
grant execute on function public.admin_approve_payout_batch(uuid) to authenticated;

-- Pesi's answer, as before, plus: a batch is done when none of its lines is still on its way.
create or replace function public.record_disbursement_result(
  p_partner_id text, p_state text, p_code text, p_descr text, p_trace text, p_raw jsonb
)
returns text   -- 'completed' | 'failed' | 'processing' | 'already_final' | 'unknown'
language plpgsql
security definer
set search_path = public
as $$
declare
  d       public.disbursements;
  verdict text;
begin
  select * into d from public.disbursements x where x.partner_transaction_id = p_partner_id for update;
  if not found or d.status in ('queued', 'cancelled') then
    return 'unknown';   -- never sent: a callback for it can't be genuine
  end if;
  if d.status in ('completed', 'failed') then
    return 'already_final';
  end if;
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
    values (d.order_id, d.farm_id, case when d.kind = 'payout' then 'payout_sent' else 'refund_sent' end,
            d.amount_kes, 'Pesi ' || coalesce(p_trace, d.partner_transaction_id), d.requested_by);
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

-- Paying by hand (outside Pesi) is still possible, but never for money that
-- is already in a batch or on its way through Pesi.
create or replace function public.admin_record_payout(fid uuid, amount numeric, ref text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  due    numeric;
  flying numeric;
begin
  perform public.require_admin();
  if coalesce(trim(ref), '') = '' then
    raise exception 'Add the M-Pesa or bank reference' using errcode = '22023';
  end if;
  select coalesce(sum(amount_kes) filter (where kind = 'payout_due'), 0) - coalesce(sum(amount_kes) filter (where kind = 'payout_sent'), 0)
    into due from public.ledger_entries where farm_id = fid;
  select coalesce(sum(amount_kes), 0) into flying from public.disbursements d
   where d.farm_id = fid and d.kind = 'payout' and d.status in ('queued', 'requested', 'processing');
  if amount <= 0 or amount > due - flying then
    raise exception 'Payout must be between 1 and the KES % due (KES % is in a Pesi batch)', due - flying, flying using errcode = '22023';
  end if;
  insert into public.ledger_entries (farm_id, kind, amount_kes, reference, actor_id)
  values (fid, 'payout_sent', amount, trim(ref), auth.uid());
end;
$$;

create or replace function public.admin_record_refund(oid uuid, ref text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  due numeric;
  fid uuid;
begin
  perform public.require_admin();
  if coalesce(trim(ref), '') = '' then
    raise exception 'Add the M-Pesa reversal or refund reference' using errcode = '22023';
  end if;
  if exists (select 1 from public.disbursements d where d.order_id = oid and d.kind = 'refund' and d.status in ('queued', 'requested', 'processing')) then
    raise exception 'This refund is in a Pesi batch' using errcode = '55000';
  end if;
  select o.farm_id into fid from public.orders o where o.id = oid;
  select coalesce(sum(amount_kes) filter (where kind = 'refund_due'), 0) - coalesce(sum(amount_kes) filter (where kind = 'refund_sent'), 0)
    into due from public.ledger_entries where order_id = oid;
  if due <= 0 then
    raise exception 'Nothing to refund on this order' using errcode = '22023';
  end if;
  insert into public.ledger_entries (order_id, farm_id, kind, amount_kes, reference, actor_id)
  values (oid, fid, 'refund_sent', due, trim(ref), auth.uid());
end;
$$;
