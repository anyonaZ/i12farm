-- i12farm · Phase 2b · Trade, finished
-- * Order upkeep: orders left "ready" are completed automatically after a few
--   days (so farmers get paid even when buyers forget to confirm), unpaid
--   orders are cancelled, and payment prompts with no answer are expired.
--   run_maintenance() does it all; the nightly workflow (or /api/cron) calls it.
-- * Bookings: training and farm tours are booked through the same cart and
--   M-Pesa flow, with a visit date and morning/afternoon slot.
-- * Featured listings: a farm pays by M-Pesa to be shown first on the map
--   and in search for a number of days. Prices are platform settings.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value, note) values
  ('auto_complete_days',  '3',  'Days after "ready" before an order completes without the buyer confirming.'),
  ('unpaid_cancel_hours', '48', 'Hours before an unpaid order is cancelled.'),
  ('premium_plans', '[{"days": 7, "price": 200}, {"days": 30, "price": 600}]',
   'Featured listing plans (KES). Placeholder prices until the business decision is made.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Bookings: a visit date on orders that contain an experience
-- ---------------------------------------------------------------------------
alter table public.orders
  add column visit_date date,
  add column visit_slot text check (visit_slot in ('morning', 'afternoon'));

create or replace function public.place_order(payload jsonb)
returns table (id uuid, number text, subtotal_kes numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  me        uuid := auth.uid();
  fid       uuid := (payload ->> 'farm_id')::uuid;
  farm      public.farms;
  item      jsonb;
  l         public.listings;
  qty       integer;
  total     numeric(12, 2) := 0;
  bps       integer := public.setting_int('commission_bps', 1000);
  fee       numeric(12, 2);
  oid       uuid := gen_random_uuid();
  onum      text;
  phone     text := public.normalise_ke_phone(payload ->> 'buyer_phone');
  seen      uuid[] := '{}';
  booking   boolean := false;
  today     date := (now() at time zone 'Africa/Nairobi')::date;
  visit     date := nullif(payload ->> 'visit_date', '')::date;
  slot      text := nullif(payload ->> 'visit_slot', '');
begin
  if me is null then
    raise exception 'Sign in to place an order' using errcode = '42501';
  end if;
  if (select status from auth.users where auth.users.id = me) <> 'active' then
    raise exception 'Account suspended' using errcode = '42501';
  end if;

  select * into farm from public.farms f where f.id = fid and f.status = 'published';
  if not found then
    raise exception 'This farm is not taking orders' using errcode = 'P0002';
  end if;
  if public.can_manage_farm(fid) then
    raise exception 'You cannot order from a farm you manage' using errcode = '42501';
  end if;
  if phone is null then
    raise exception 'Enter a Safaricom number like 0712 345 678' using errcode = '22023';
  end if;
  if jsonb_typeof(payload -> 'items') <> 'array' or jsonb_array_length(payload -> 'items') = 0
     or jsonb_array_length(payload -> 'items') > 20 then
    raise exception 'Add between 1 and 20 items' using errcode = '22023';
  end if;

  loop
    onum := upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from public.orders o where o.number = onum);
  end loop;

  insert into public.orders (id, number, buyer_id, farm_id, county_code, fulfilment, delivery_note,
                             buyer_name, buyer_phone, subtotal_kes, commission_bps, commission_kes, farmer_payout_kes)
  values (oid, onum, me, fid, farm.county_code,
          coalesce(nullif(payload ->> 'fulfilment', ''), 'pickup')::public.fulfilment,
          nullif(trim(payload ->> 'delivery_note'), ''),
          nullif(trim(payload ->> 'buyer_name'), ''),
          phone, 1, bps, 0, 1);

  for item in select * from jsonb_array_elements(payload -> 'items') loop
    qty := (item ->> 'quantity')::integer;
    select * into l from public.listings x
     where x.id = (item ->> 'listing_id')::uuid and x.farm_id = fid and x.status = 'active' and x.price_kes is not null;
    if not found then
      raise exception 'One of the items is no longer available' using errcode = 'P0002';
    end if;
    if l.id = any (seen) then
      raise exception 'The same item appears twice' using errcode = '22023';
    end if;
    seen := seen || l.id;
    if qty is null or qty < 1 or qty > 10000 then
      raise exception 'Quantities must be whole numbers from 1' using errcode = '22023';
    end if;
    if l.quantity is not null and qty > l.quantity then
      raise exception 'Only % % of % left', l.quantity, l.unit, l.title using errcode = '22023';
    end if;
    booking := booking or l.type = 'experience';
    insert into public.order_items (order_id, listing_id, product_slug, title, unit, unit_price_kes, quantity, line_total_kes)
    values (oid, l.id, l.product_slug, l.title, l.unit, l.price_kes, qty, l.price_kes * qty);
    total := total + l.price_kes * qty;
  end loop;

  if booking then
    if visit is null or visit < today + 1 or visit > today + 120 then
      raise exception 'Choose a visit date from tomorrow up to four months ahead' using errcode = '22023';
    end if;
    if slot is null or slot not in ('morning', 'afternoon') then
      slot := 'morning';
    end if;
  else
    visit := null;
    slot := null;
  end if;

  if total < public.setting_int('min_order_kes', 50) then
    raise exception 'The smallest order is KES %', public.setting_int('min_order_kes', 50) using errcode = '22023';
  end if;
  if total > 250000 then
    raise exception 'M-Pesa takes at most KES 250,000 per payment; split the order' using errcode = '22023';
  end if;

  fee := round(total * bps / 10000.0, 0);
  update public.orders o
     set subtotal_kes = total, commission_kes = fee, farmer_payout_kes = total - fee,
         visit_date = visit, visit_slot = slot
   where o.id = oid;

  return query select oid, onum, total;
end;
$$;
revoke execute on function public.place_order(jsonb) from public, anon;
grant execute on function public.place_order(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- One place that moves an order and writes the money that follows.
-- Not callable by users; set_order_status() checks permissions first.
-- ---------------------------------------------------------------------------
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
    values (oid, o.farm_id, 'payout_due', o.farmer_payout_kes, actor);
  elsif to_status in ('cancelled', 'declined') and o.paid_at is not null then
    insert into public.ledger_entries (order_id, farm_id, kind, amount_kes, actor_id)
    values (oid, o.farm_id, 'refund_due', o.subtotal_kes, actor);
  end if;
end;
$$;
revoke execute on function public.apply_order_status(uuid, public.order_status, text, uuid) from public, anon, authenticated;

create or replace function public.set_order_status(oid uuid, to_status public.order_status, note text default null)
returns public.order_status
language plpgsql
security definer
set search_path = public
as $$
declare
  me        uuid := auth.uid();
  o         public.orders;
  is_buyer  boolean;
  is_farm   boolean;
  is_admin  boolean := public.has_role('admin');
  allowed   boolean := false;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into o from public.orders x where x.id = oid for update;
  if not found then
    raise exception 'No such order' using errcode = 'P0002';
  end if;
  is_buyer := o.buyer_id = me;
  is_farm  := public.can_manage_farm(o.farm_id);

  allowed :=
       (is_buyer and o.status = 'awaiting_payment' and to_status = 'cancelled')
    or (is_buyer and o.status = 'ready'            and to_status = 'completed')
    or (is_farm  and o.status = 'paid'             and to_status in ('accepted', 'declined'))
    or (is_farm  and o.status = 'accepted'         and to_status in ('ready', 'declined'))
    or (is_admin and o.status = 'awaiting_payment' and to_status = 'cancelled')
    or (is_admin and o.status in ('paid', 'accepted', 'ready') and to_status in ('accepted', 'ready', 'completed', 'cancelled', 'declined')
                 and to_status <> o.status);

  if not allowed then
    raise exception 'Cannot move order from % to %', o.status, to_status using errcode = '42501';
  end if;

  perform public.apply_order_status(oid, to_status, note, me);
  return to_status;
end;
$$;
revoke execute on function public.set_order_status(uuid, public.order_status, text) from public, anon;
grant execute on function public.set_order_status(uuid, public.order_status, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Featured listings
-- ---------------------------------------------------------------------------
create table public.farm_promotions (
  id            uuid primary key default gen_random_uuid(),
  farm_id       uuid not null references public.farms (id) on delete cascade,
  days          integer not null check (days between 1 and 365),
  amount_kes    integer not null check (amount_kes > 0),
  status        text not null default 'awaiting_payment'
                check (status in ('awaiting_payment', 'active', 'expired', 'cancelled')),
  starts_at     timestamptz,
  ends_at       timestamptz,
  requested_by  uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint farm_promotions_window check ((starts_at is null) = (ends_at is null) and (ends_at is null or ends_at > starts_at))
);
create index farm_promotions_farm_idx on public.farm_promotions (farm_id, status, ends_at);

alter table public.farm_promotions enable row level security;
revoke all on public.farm_promotions from anon;
revoke insert, update, delete on public.farm_promotions from authenticated;
create policy "farm managers and admins read promotions" on public.farm_promotions
  for select to authenticated using (public.can_manage_farm(farm_id) or public.has_role('admin'));

-- Public yes/no for the map; the promotion rows themselves stay private.
create or replace function public.farm_featured(fid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.farm_promotions p
    where p.farm_id = fid and p.status = 'active' and now() >= p.starts_at and now() < p.ends_at
  );
$$;
grant execute on function public.farm_featured(uuid) to anon, authenticated;

create or replace function public.request_promotion(fid uuid, plan_days integer)
returns table (id uuid, amount_kes integer, days integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  price integer;
  pid   uuid;
begin
  if not public.can_manage_farm(fid) then
    raise exception 'You do not manage this farm' using errcode = '42501';
  end if;
  if not exists (select 1 from public.farms f where f.id = fid and f.status = 'published') then
    raise exception 'Only published farms can be featured' using errcode = '22023';
  end if;
  select (p ->> 'price')::integer into price
  from public.platform_settings s, jsonb_array_elements(s.value) p
  where s.key = 'premium_plans' and (p ->> 'days')::integer = plan_days;
  if price is null then
    raise exception 'Unknown plan' using errcode = '22023';
  end if;
  update public.farm_promotions x set status = 'cancelled'
   where x.farm_id = fid and x.status = 'awaiting_payment';
  insert into public.farm_promotions (farm_id, days, amount_kes, requested_by)
  values (fid, plan_days, price, auth.uid())
  returning farm_promotions.id into pid;
  return query select pid, price, plan_days;
end;
$$;
revoke execute on function public.request_promotion(uuid, integer) from public, anon;
grant execute on function public.request_promotion(uuid, integer) to authenticated;

-- Payments now pay for an order or a promotion (exactly one).
alter table public.payments
  alter column order_id drop not null,
  add column promotion_id uuid references public.farm_promotions (id) on delete cascade,
  add constraint payments_one_target check (num_nonnulls(order_id, promotion_id) = 1);
create index payments_promotion_idx on public.payments (promotion_id, requested_at desc);

create policy "promotion payments to farm managers" on public.payments
  for select to authenticated
  using (promotion_id is not null and exists (select 1 from public.farm_promotions p where p.id = promotion_id));

alter table public.ledger_entries drop constraint ledger_entries_kind_check;
alter table public.ledger_entries add constraint ledger_entries_kind_check check (kind in (
  'buyer_payment', 'commission', 'farmer_payable', 'payout_due', 'payout_sent', 'refund_due', 'refund_sent',
  'promotion_fee'));   -- a farm paid to be featured (our revenue)

create or replace function public.record_promotion_payment_request(
  pid uuid, phone text, amount integer, merchant_id text, checkout_id text, by_user uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  id uuid;
begin
  insert into public.payments (promotion_id, phone, amount_kes, merchant_request_id, checkout_request_id, requested_by)
  values (pid, phone, amount, merchant_id, checkout_id, by_user)
  returning payments.id into id;
  return id;
end;
$$;
revoke execute on function public.record_promotion_payment_request(uuid, text, integer, text, text, uuid) from public, anon, authenticated;

-- Same rules as before, plus: promotions, and a late success on a prompt
-- that maintenance had expired for lack of an answer still counts.
create or replace function public.record_payment_result(
  checkout_id text, code integer, descr text, receipt text, paid_amount numeric, raw jsonb
)
returns text   -- 'paid' | 'already_final' | 'failed' | 'unknown' | 'underpaid' | 'paid_after_cancel'
language plpgsql
security definer
set search_path = public
as $$
declare
  p      public.payments;
  o      public.orders;
  promo  public.farm_promotions;
  l      record;
  start  timestamptz;
begin
  select * into p from public.payments x where x.checkout_request_id = checkout_id for update;
  if not found then
    return 'unknown';
  end if;
  if not (p.status = 'requested' or (p.status = 'expired' and p.result_code is null)) then
    return 'already_final';
  end if;

  if code <> 0 then
    update public.payments x
       set status = case when code = 1032 then 'cancelled'::public.payment_status
                         when code in (1037, 1019) then 'expired'::public.payment_status
                         else 'failed'::public.payment_status end,
           result_code = code, result_desc = descr, callback = raw, completed_at = now()
     where x.id = p.id;
    return 'failed';
  end if;

  update public.payments x
     set status = 'succeeded', result_code = 0, result_desc = descr, mpesa_receipt = receipt,
         callback = raw, completed_at = now()
   where x.id = p.id;

  -- Featured listing
  if p.promotion_id is not null then
    select * into promo from public.farm_promotions x where x.id = p.promotion_id for update;
    insert into public.ledger_entries (farm_id, kind, amount_kes, reference)
    values (promo.farm_id, 'promotion_fee', coalesce(paid_amount, p.amount_kes), receipt);
    if coalesce(paid_amount, 0) < promo.amount_kes then
      return 'underpaid';
    end if;
    -- A second plan bought while one is running starts when the first ends.
    select greatest(now(), coalesce(max(x.ends_at), now())) into start
      from public.farm_promotions x
     where x.farm_id = promo.farm_id and x.status = 'active' and x.id <> promo.id;
    update public.farm_promotions x
       set status = 'active', starts_at = start, ends_at = start + make_interval(days => promo.days)
     where x.id = promo.id;
    return 'paid';
  end if;

  -- Order
  select * into o from public.orders x where x.id = p.order_id for update;

  insert into public.ledger_entries (order_id, farm_id, kind, amount_kes, reference)
  values (o.id, o.farm_id, 'buyer_payment', coalesce(paid_amount, p.amount_kes), receipt);

  if o.status <> 'awaiting_payment' then
    insert into public.ledger_entries (order_id, farm_id, kind, amount_kes, reference)
    values (o.id, o.farm_id, 'refund_due', coalesce(paid_amount, p.amount_kes), receipt);
    return 'paid_after_cancel';
  end if;

  if coalesce(paid_amount, 0) < o.subtotal_kes then
    insert into public.ledger_entries (order_id, farm_id, kind, amount_kes, reference)
    values (o.id, o.farm_id, 'refund_due', coalesce(paid_amount, 0), receipt);
    return 'underpaid';
  end if;

  perform set_config('i12farm.status_note', 'M-Pesa ' || coalesce(receipt, ''), true);
  update public.orders x set status = 'paid', paid_at = now() where x.id = o.id;
  perform set_config('i12farm.status_note', '', true);

  insert into public.ledger_entries (order_id, farm_id, kind, amount_kes, reference) values
    (o.id, o.farm_id, 'commission',     o.commission_kes,    receipt),
    (o.id, o.farm_id, 'farmer_payable', o.farmer_payout_kes, receipt);

  for l in select i.listing_id, i.quantity from public.order_items i where i.order_id = o.id and i.listing_id is not null loop
    update public.listings x
       set quantity = greatest(x.quantity - l.quantity, 0),
           status = case when x.quantity is not null and x.quantity - l.quantity <= 0 then 'sold_out'::public.listing_status else x.status end
     where x.id = l.listing_id and x.quantity is not null;
  end loop;

  return 'paid';
end;
$$;
revoke execute on function public.record_payment_result(text, integer, text, text, numeric, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Upkeep, run nightly (and safe to run any time; it only moves what is due)
-- ---------------------------------------------------------------------------
create or replace function public.run_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  days     integer := public.setting_int('auto_complete_days', 3);
  hours    integer := public.setting_int('unpaid_cancel_hours', 48);
  r        record;
  done     integer := 0;
  dropped  integer := 0;
  expired  integer := 0;
  ended    integer := 0;
begin
  for r in
    select o.id from public.orders o
    where o.status = 'ready'
      and (select max(h.at) from public.order_status_history h where h.order_id = o.id and h.to_status = 'ready')
          < now() - make_interval(days => days)
    for update skip locked
  loop
    perform public.apply_order_status(r.id, 'completed', format('Completed automatically %s days after it was ready', days), null);
    done := done + 1;
  end loop;

  for r in
    select o.id from public.orders o
    where o.status = 'awaiting_payment'
      and o.created_at < now() - make_interval(hours => hours)
      and not exists (select 1 from public.payments p
                       where p.order_id = o.id and p.status = 'requested' and p.requested_at > now() - interval '10 minutes')
    for update skip locked
  loop
    perform public.apply_order_status(r.id, 'cancelled', format('Not paid within %s hours', hours), null);
    dropped := dropped + 1;
  end loop;

  update public.payments p
     set status = 'expired', result_desc = 'No answer from M-Pesa', completed_at = now()
   where p.status = 'requested' and p.requested_at < now() - interval '1 hour';
  get diagnostics expired = row_count;

  update public.farm_promotions x set status = 'expired' where x.status = 'active' and x.ends_at <= now();
  get diagnostics ended = row_count;
  update public.farm_promotions x set status = 'cancelled'
   where x.status = 'awaiting_payment' and x.created_at < now() - interval '1 day';

  return jsonb_build_object('auto_completed', done, 'unpaid_cancelled', dropped,
                            'payments_expired', expired, 'promotions_ended', ended, 'ran_at', now());
end;
$$;
revoke execute on function public.run_maintenance() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Map and search: featured farms first (replaces the Phase 2 versions)
-- ---------------------------------------------------------------------------
drop function if exists public.farms_in_bbox(double precision, double precision, double precision, double precision, text[], smallint, integer);
drop function if exists public.search_farms(text, text[], smallint, integer);

create or replace function public.farms_in_bbox(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  category_filter text[] default null,
  county_filter   smallint default null,
  max_rows        integer default 500
)
returns table (
  id uuid, slug text, name text, farmer_name text, categories text[], county_code smallint, county_name text,
  place_name text, lng double precision, lat double precision, verified boolean, cover_path text,
  min_price_kes numeric, min_price_unit text, listing_count integer, rating numeric, review_count integer,
  featured boolean
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select f.id, f.slug, f.name, f.farmer_name, f.categories, f.county_code, c.name, f.place_name,
         st_x(f.public_location::geometry), st_y(f.public_location::geometry),
         f.verified_at is not null,
         (select m.storage_path from public.farm_media m
           where m.farm_id = f.id and m.kind = 'photo' order by m.position, m.created_at limit 1),
         p.price_kes, p.unit,
         (select count(*)::integer from public.listings l where l.farm_id = f.id and l.status = 'active'),
         r.avg_rating, r.n,
         public.farm_featured(f.id) as featured
  from public.farms f
  join public.counties c on c.code = f.county_code
  left join lateral (
    select l.price_kes, l.unit from public.listings l
    where l.farm_id = f.id and l.status = 'active' and l.price_kes is not null
    order by l.price_kes limit 1
  ) p on true
  left join lateral (
    select round(avg(rv.rating)::numeric, 1) as avg_rating, count(*)::integer as n
    from public.reviews rv where rv.farm_id = f.id
  ) r on true
  where f.status = 'published'
    and f.public_location is not null
    and f.public_location && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
    and (category_filter is null or f.categories && category_filter)
    and (county_filter is null or f.county_code = county_filter)
  order by public.farm_featured(f.id) desc, f.verified_at is not null desc, f.published_at desc
  limit least(greatest(max_rows, 1), 1000);
$$;

create or replace function public.search_farms(
  q               text,
  category_filter text[] default null,
  county_filter   smallint default null,
  max_rows        integer default 50
)
returns table (
  id uuid, slug text, name text, farmer_name text, categories text[], county_code smallint, county_name text,
  place_name text, lng double precision, lat double precision, verified boolean, cover_path text,
  min_price_kes numeric, min_price_unit text, listing_count integer, rating numeric, review_count integer,
  featured boolean
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with terms as (
    select array_remove(regexp_split_to_array(lower(trim(coalesce(q, ''))), '\s+'), '') as words
  )
  select f.id, f.slug, f.name, f.farmer_name, f.categories, f.county_code, c.name, f.place_name,
         case when f.public_location is null then null else st_x(f.public_location::geometry) end,
         case when f.public_location is null then null else st_y(f.public_location::geometry) end,
         f.verified_at is not null,
         (select m.storage_path from public.farm_media m
           where m.farm_id = f.id and m.kind = 'photo' order by m.position, m.created_at limit 1),
         p.price_kes, p.unit,
         (select count(*)::integer from public.listings l where l.farm_id = f.id and l.status = 'active'),
         r.avg_rating, r.n,
         public.farm_featured(f.id) as featured
  from public.farms f
  join public.counties c on c.code = f.county_code
  cross join terms
  left join lateral (
    select l.price_kes, l.unit from public.listings l
    where l.farm_id = f.id and l.status = 'active' and l.price_kes is not null
    order by l.price_kes limit 1
  ) p on true
  left join lateral (
    select round(avg(rv.rating)::numeric, 1) as avg_rating, count(*)::integer as n
    from public.reviews rv where rv.farm_id = f.id
  ) r on true
  left join lateral (
    select string_agg(lower(concat_ws(' ', l.title, pr.name_en, pr.name_sw)), ' ') as text
    from public.listings l left join public.products pr on pr.slug = l.product_slug
    where l.farm_id = f.id and l.status in ('active', 'sold_out')
  ) li on true
  left join lateral (
    select string_agg(lower(fc.name_en || ' ' || fc.name_sw), ' ') as text
    from public.farm_categories fc where fc.slug = any (f.categories)
  ) ca on true
  where f.status = 'published'
    and cardinality(terms.words) > 0
    and (category_filter is null or f.categories && category_filter)
    and (county_filter is null or f.county_code = county_filter)
    and not exists (
      select 1 from unnest(terms.words) w
      where position(w in lower(concat_ws(' ', f.name, f.farmer_name, f.place_name, c.name, li.text, ca.text))) = 0
    )
  order by public.farm_featured(f.id) desc, f.verified_at is not null desc, f.published_at desc
  limit least(greatest(max_rows, 1), 200);
$$;

grant execute on function public.farms_in_bbox(double precision, double precision, double precision, double precision, text[], smallint, integer) to anon, authenticated;
grant execute on function public.search_farms(text, text[], smallint, integer) to anon, authenticated;
