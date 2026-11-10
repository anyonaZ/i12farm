-- i12farm · Payments through Pesi Pay (Switchlink) instead of Daraja (decision of 10 Nov 2026)
-- Buyers still approve an M-Pesa prompt on their phone; Pesi sends it and
-- tells us the result. Pesi also pays money out (farmer payouts, refunds) to
-- M-Pesa, banks, tills and paybills, which Daraja did not give us without B2C.
--
-- Not yet connected: Switchlink has not onboarded i12farm. Everything here
-- works in simulate mode and against a local stand-in (scripts/pesi-mock.mjs).
--
-- payments.checkout_request_id now holds our Pesi "partnerReference" (I12P…);
-- payments.mpesa_receipt holds the M-Pesa receipt if Pesi sends one, else
-- Pesi's Trace_Id. Old Daraja rows keep provider = 'mpesa'.

alter table public.payments drop constraint payments_provider_check;
alter table public.payments add constraint payments_provider_check check (provider in ('mpesa', 'pesi'));
alter table public.payments alter column provider set default 'pesi';
comment on column public.payments.checkout_request_id is 'Pesi partnerReference (I12P…) for provider pesi; Daraja CheckoutRequestID for provider mpesa';
comment on column public.payments.mpesa_receipt is 'M-Pesa receipt, or Pesi Trace_Id when Pesi sends no receipt';

-- ---------------------------------------------------------------------------
-- Banks Pesi pays to. Names must be sent exactly as Pesi lists them.
-- ---------------------------------------------------------------------------
create table public.pesi_banks (
  code text primary key check (code ~ '^[0-9]{2,3}$'),
  name text not null unique
);
alter table public.pesi_banks enable row level security;
revoke insert, update, delete on public.pesi_banks from anon, authenticated;
create policy "banks readable" on public.pesi_banks for select using (true);

insert into public.pesi_banks (code, name) values
  ('01', 'KENYA COMMERCIAL BANK'), ('02', 'STANDARD CHARTERED BANK'), ('03', 'ABSA KENYA'), ('06', 'BANK OF BARODA'),
  ('07', 'NCBA BANK'), ('08', 'HABIB BANK LTD'), ('10', 'PRIME BANK'), ('11', 'THE COOPERATIVE BANK OF KENYA'),
  ('12', 'NATIONAL BANK'), ('14', 'M-ORIENTAL BANK LIMITED'), ('16', 'CITIBANK'), ('17', 'HABIB BANK A.G. ZURICH'),
  ('18', 'MIDDLE EAST BANK'), ('19', 'BANK OF AFRICA'), ('23', 'CONSOLIDATED BANK'), ('25', 'CREDIT BANK'),
  ('26', 'TRANSNATIONAL BANK'), ('31', 'STANBIC BANK KENYA LIMITED'), ('35', 'AFRICAN BANKING CORP'),
  ('39', 'IMPERIAL BANK OF KENYA'), ('42', 'GIRO BANK / GIRO BANK LTD / COMMERCE BANK'), ('43', 'ECOBANK'),
  ('46', 'CHOICE MICROFINANCE BANK'), ('49', 'SPIRE BANK LTD'), ('50', 'PARAMOUNT UNIVERSAL BANK LTD'),
  ('51', 'JAMII BORA BANK'), ('53', 'GUARANTY TRUST BANK (KENYA) LTD'), ('54', 'VICTORIA COMMERCIAL BANK LTD'),
  ('55', 'GUARDIAN BANK LTD'), ('57', 'I & M BANK LTD'), ('59', 'DEVELOPMENT BANK OF KENYA'),
  ('60', 'SBM BANK / FIDELITY COMMERCIAL BANK'), ('61', 'HOUSING FINANCE CO. KENYA'), ('63', 'DIAMOND TRUST BANK'),
  ('65', 'MAYFAIR BANK'), ('66', 'SIDIAN BANK'), ('68', 'EQUITY BANK LIMITED'), ('70', 'FAMILY BANK LIMITED'),
  ('72', 'GULF AFRICAN BANK'), ('74', 'FIRST COMMUNITY BANK'), ('75', 'DUBAI ISLAMIC BANK'), ('76', 'UBA KENYA BANK LTD'),
  ('78', 'KWFT BANK'), ('79', 'FAULU MICROFINANCE BANK'), ('86', 'BANK OF INDIA'), ('102', 'POST OFFICE BANK')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Where a farm wants its money: M-Pesa number, bank account, paybill or till.
-- Private to the farm's managers and admins. Every change is kept.
-- registered_name is the name Pesi's "Hakikisha" check returned, so the farm
-- and the admin can see the money is going to the right person.
-- ---------------------------------------------------------------------------
create table public.farm_payout_accounts (
  farm_id          uuid primary key references public.farms (id) on delete cascade,
  channel          text not null check (channel in ('M', 'B', 'PAYBILL', 'TILL')),
  mobile           text check (mobile ~ '^254[17][0-9]{8}$'),
  bank_code        text references public.pesi_banks (code),
  account_number   text check (char_length(account_number) between 1 and 40),
  business_number  text check (business_number ~ '^[0-9]{5,8}$'),   -- paybill or till
  registered_name  text check (char_length(registered_name) <= 120),
  checked_at       timestamptz,
  updated_by       uuid references public.profiles (id) on delete set null,
  updated_at       timestamptz not null default now(),
  constraint farm_payout_accounts_shape check (
    (channel = 'M' and mobile is not null)
    or (channel = 'B' and bank_code is not null and account_number is not null)
    or (channel = 'PAYBILL' and business_number is not null and account_number is not null)
    or (channel = 'TILL' and business_number is not null))
);
create table public.farm_payout_account_history (
  id          bigint generated always as identity primary key,
  farm_id     uuid not null references public.farms (id) on delete cascade,
  details     jsonb not null,
  changed_by  uuid references public.profiles (id) on delete set null,
  changed_at  timestamptz not null default now()
);
alter table public.farm_payout_accounts enable row level security;
alter table public.farm_payout_account_history enable row level security;
revoke insert, update, delete on public.farm_payout_accounts from anon, authenticated;
revoke all on public.farm_payout_account_history from anon, authenticated;
create policy "payout account to farm managers and admins" on public.farm_payout_accounts
  for select to authenticated using (public.can_manage_farm(farm_id) or public.has_role('admin'));

-- Server-only: the server checks the receiver with Pesi first, then saves.
create or replace function public.set_farm_payout_account(
  p_actor uuid, p_farm uuid, p_channel text, p_mobile text, p_bank_code text,
  p_account text, p_business text, p_registered_name text
)
returns public.farm_payout_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.farm_payout_accounts;
begin
  if not exists (select 1 from public.farms f where f.id = p_farm and (f.owner_id = p_actor or f.managed_by = p_actor))
     and not exists (select 1 from public.profiles p where p.id = p_actor and 'admin' = any (p.roles)) then
    raise exception 'Only the farm''s managers can set where its money goes' using errcode = '42501';
  end if;
  insert into public.farm_payout_accounts as a
    (farm_id, channel, mobile, bank_code, account_number, business_number, registered_name, checked_at, updated_by, updated_at)
  values (p_farm, p_channel, case when p_channel = 'M' then public.normalise_ke_phone(p_mobile) end,
          case when p_channel = 'B' then p_bank_code end,
          case when p_channel in ('B', 'PAYBILL') then nullif(trim(p_account), '') end,
          case when p_channel in ('PAYBILL', 'TILL') then nullif(trim(p_business), '') end,
          nullif(trim(p_registered_name), ''), case when nullif(trim(p_registered_name), '') is not null then now() end,
          p_actor, now())
  on conflict (farm_id) do update set
    channel = excluded.channel, mobile = excluded.mobile, bank_code = excluded.bank_code,
    account_number = excluded.account_number, business_number = excluded.business_number,
    registered_name = excluded.registered_name, checked_at = excluded.checked_at,
    updated_by = excluded.updated_by, updated_at = now()
  returning * into row;
  insert into public.farm_payout_account_history (farm_id, details, changed_by)
  values (p_farm, to_jsonb(row) - 'farm_id', p_actor);
  return row;
end;
$$;
revoke execute on function public.set_farm_payout_account(uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Money out through Pesi: farmer payouts and buyer refunds.
-- A disbursement reserves its amount while it is in flight, so the same
-- money can't be sent twice; the ledger row (payout_sent / refund_sent) is
-- written only when Pesi reports COMPLETED.
-- ---------------------------------------------------------------------------
create table public.disbursements (
  id                      uuid primary key default gen_random_uuid(),
  partner_transaction_id  text not null unique check (partner_transaction_id ~ '^I12D[0-9a-f]{24}$'),
  kind                    text not null check (kind in ('payout', 'refund')),
  farm_id                 uuid not null references public.farms (id),
  order_id                uuid references public.orders (id),
  amount_kes              numeric(12, 2) not null check (amount_kes > 0),
  channel                 text not null check (channel in ('M', 'B', 'PAYBILL', 'TILL')),
  receiver                jsonb not null,            -- what was sent to Pesi (name, number, bank…)
  validated_name          text,                      -- Hakikisha result at the time
  status                  text not null default 'requested' check (status in ('requested', 'processing', 'completed', 'failed')),
  status_code             text,
  status_description      text,
  trace_id                text,
  callback                jsonb,
  requested_by            uuid references public.profiles (id) on delete set null,
  requested_at            timestamptz not null default now(),
  completed_at            timestamptz,
  constraint disbursements_refund_has_order check (kind = 'payout' or order_id is not null)
);
create index disbursements_farm_idx on public.disbursements (farm_id, status);
create index disbursements_order_idx on public.disbursements (order_id) where order_id is not null;
alter table public.disbursements enable row level security;
revoke insert, update, delete on public.disbursements from anon, authenticated;
create policy "disbursements to admins" on public.disbursements
  for select to authenticated using (public.has_role('admin'));
create policy "payouts to their farm" on public.disbursements
  for select to authenticated using (kind = 'payout' and public.can_manage_farm(farm_id));

-- Admin starts a payout or refund (the server then calls Pesi).
create or replace function public.admin_start_disbursement(
  p_kind text, p_farm uuid, p_order uuid, p_amount numeric, p_channel text, p_receiver jsonb,
  p_validated_name text, p_partner_id text
)
returns public.disbursements
language plpgsql
security definer
set search_path = public
as $$
declare
  due      numeric;
  flying   numeric;
  fid      uuid := p_farm;
  row      public.disbursements;
begin
  perform public.require_admin();
  if p_kind = 'payout' then
    select coalesce(sum(amount_kes) filter (where kind = 'payout_due'), 0) - coalesce(sum(amount_kes) filter (where kind = 'payout_sent'), 0)
      into due from public.ledger_entries where farm_id = p_farm;
    select coalesce(sum(amount_kes), 0) into flying from public.disbursements d
     where d.farm_id = p_farm and d.kind = 'payout' and d.status in ('requested', 'processing');
  elsif p_kind = 'refund' then
    select o.farm_id into fid from public.orders o where o.id = p_order;
    select coalesce(sum(amount_kes) filter (where kind = 'refund_due'), 0) - coalesce(sum(amount_kes) filter (where kind = 'refund_sent'), 0)
      into due from public.ledger_entries where order_id = p_order;
    select coalesce(sum(amount_kes), 0) into flying from public.disbursements d
     where d.order_id = p_order and d.kind = 'refund' and d.status in ('requested', 'processing');
  else
    raise exception 'Unknown kind %', p_kind using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > due - flying then
    raise exception 'Amount must be between 1 and the KES % still due (KES % already on its way)', due - flying, flying
      using errcode = '22023';
  end if;
  insert into public.disbursements (partner_transaction_id, kind, farm_id, order_id, amount_kes, channel, receiver, validated_name, requested_by)
  values (p_partner_id, p_kind, fid, p_order, p_amount, p_channel, p_receiver, nullif(trim(p_validated_name), ''), auth.uid())
  returning * into row;
  insert into auth.audit_log (actor_id, action, target_id, details)
  values (auth.uid(), 'disbursement.start', null,   -- target_id is for user accounts
          jsonb_build_object('disbursement', row.id, 'kind', p_kind, 'amount', p_amount, 'farm', fid, 'order', p_order,
                             'reference', p_partner_id));
  return row;
end;
$$;
revoke execute on function public.admin_start_disbursement(text, uuid, uuid, numeric, text, jsonb, text, text) from public, anon;
grant execute on function public.admin_start_disbursement(text, uuid, uuid, numeric, text, jsonb, text, text) to authenticated;

-- Server-only: Pesi's answer (callback or status query). Idempotent.
create or replace function public.record_disbursement_result(
  p_partner_id text, p_state text, p_code text, p_descr text, p_trace text, p_raw jsonb
)
returns text   -- 'completed' | 'failed' | 'processing' | 'already_final' | 'unknown'
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.disbursements;
begin
  select * into d from public.disbursements x where x.partner_transaction_id = p_partner_id for update;
  if not found then
    return 'unknown';
  end if;
  if d.status in ('completed', 'failed') then
    return 'already_final';
  end if;
  if p_state = 'processing' then
    update public.disbursements x set status = 'processing', status_code = p_code, status_description = p_descr,
           trace_id = coalesce(p_trace, x.trace_id), callback = p_raw
     where x.id = d.id;
    return 'processing';
  end if;
  if p_state = 'completed' then
    update public.disbursements x set status = 'completed', status_code = p_code, status_description = p_descr,
           trace_id = coalesce(p_trace, x.trace_id), callback = p_raw, completed_at = now()
     where x.id = d.id;
    insert into public.ledger_entries (order_id, farm_id, kind, amount_kes, reference, actor_id)
    values (d.order_id, d.farm_id, case when d.kind = 'payout' then 'payout_sent' else 'refund_sent' end,
            d.amount_kes, 'Pesi ' || coalesce(p_trace, d.partner_transaction_id), d.requested_by);
    return 'completed';
  end if;
  if p_state = 'failed' then
    update public.disbursements x set status = 'failed', status_code = p_code, status_description = p_descr,
           trace_id = coalesce(p_trace, x.trace_id), callback = p_raw, completed_at = now()
     where x.id = d.id;
    return 'failed';
  end if;
  return 'unknown';
end;
$$;
revoke execute on function public.record_disbursement_result(text, text, text, text, text, jsonb) from public, anon, authenticated;
