-- i12farm · Phase 2 · Trade
-- Orders with a price snapshot, an append-only status history, M-Pesa
-- payments, an append-only money ledger (what the buyer paid, our
-- commission, what the farmer is owed and when it was paid out), reviews
-- after a completed order, and buyer–farm messaging.
--
-- Money rules live here, not in the app:
--   * place_order() prices every line from the farm's current listings; the
--     client only sends listing ids and quantities.
--   * Only record_payment_result() (server-only, never granted to users)
--     marks an order paid. It is idempotent: a repeated M-Pesa callback is a no-op.
--   * set_order_status() enforces who may move an order where.
--   * Every money movement is a new ledger row; nothing is updated in place.

create type public.order_status   as enum ('awaiting_payment', 'paid', 'accepted', 'ready', 'completed', 'cancelled', 'declined');
create type public.fulfilment     as enum ('pickup', 'delivery');
create type public.payment_status as enum ('requested', 'succeeded', 'failed', 'cancelled', 'expired');

-- ---------------------------------------------------------------------------
-- Platform settings (commission rate etc.), with history
-- ---------------------------------------------------------------------------
create table public.platform_settings (
  key         text primary key check (key ~ '^[a-z_]{2,40}$'),
  value       jsonb not null,
  note        text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

create table public.platform_settings_history (
  id          bigint generated always as identity primary key,
  key         text not null,
  value       jsonb not null,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);

create or replace function public.platform_settings_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.platform_settings_history (key, value, changed_by) values (new.key, new.value, auth.uid());
  return null;
end;
$$;

create trigger platform_settings_record
  after insert or update on public.platform_settings
  for each row execute function public.platform_settings_record();

-- 10% until the open decision is made (deck says 10%, concept doc 5–10%).
insert into public.platform_settings (key, value, note) values
  ('commission_bps', '1000', 'Commission in basis points (1000 = 10%). Snapshotted on every order.'),
  ('min_order_kes',  '50',   'Smallest order total M-Pesa will be asked for.')
on conflict (key) do nothing;

alter table public.platform_settings enable row level security;
alter table public.platform_settings_history enable row level security;
revoke insert, update, delete on public.platform_settings from anon, authenticated;
revoke all on public.platform_settings_history from anon, authenticated;
create policy "settings readable" on public.platform_settings for select using (true);

create or replace function public.setting_int(k text, fallback integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (value #>> '{}')::integer from public.platform_settings where key = k), fallback);
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
  insert into public.platform_settings (key, value, updated_by) values (k, v, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
end;
$$;
revoke execute on function public.admin_set_setting(text, jsonb) from public, anon;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create table public.orders (
  id                 uuid primary key default gen_random_uuid(),
  number             text not null unique check (number ~ '^[0-9A-F]{6,8}$'),
  buyer_id           uuid not null references public.profiles (id),
  farm_id            uuid not null references public.farms (id),
  county_code        smallint not null references public.counties (code),   -- the farm's county
  status             public.order_status not null default 'awaiting_payment',
  fulfilment         public.fulfilment not null default 'pickup',
  delivery_note      text check (char_length(delivery_note) <= 500),
  buyer_name         text check (char_length(buyer_name) <= 120),
  buyer_phone        text not null check (buyer_phone ~ '^254[17][0-9]{8}$'),  -- contact and M-Pesa number
  subtotal_kes       numeric(12, 2) not null check (subtotal_kes > 0),
  commission_bps     integer not null check (commission_bps between 0 and 5000),
  commission_kes     numeric(12, 2) not null check (commission_kes >= 0),
  farmer_payout_kes  numeric(12, 2) not null check (farmer_payout_kes >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  paid_at            timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  constraint orders_money_adds_up check (commission_kes + farmer_payout_kes = subtotal_kes)
);
create index orders_buyer_idx on public.orders (buyer_id, created_at desc);
create index orders_farm_idx  on public.orders (farm_id, status, created_at desc);
create index orders_time_idx  on public.orders (created_at);

create trigger orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete cascade,
  listing_id      uuid references public.listings (id) on delete set null,
  product_slug    text references public.products (slug),
  title           text not null,
  unit            text not null,
  unit_price_kes  numeric(12, 2) not null check (unit_price_kes > 0),
  quantity        integer not null check (quantity between 1 and 10000),
  line_total_kes  numeric(12, 2) not null,
  constraint order_items_total check (line_total_kes = unit_price_kes * quantity)
);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_product_idx on public.order_items (product_slug);

-- Append-only: one row per status change, with who did it.
create table public.order_status_history (
  id           bigint generated always as identity primary key,
  order_id     uuid not null references public.orders (id) on delete cascade,
  from_status  public.order_status,
  to_status    public.order_status not null,
  actor_id     uuid references public.profiles (id) on delete set null,   -- null = system (M-Pesa)
  note         text check (char_length(note) <= 500),
  at           timestamptz not null default now()
);
create index order_status_history_order_idx on public.order_status_history (order_id, at);

-- ---------------------------------------------------------------------------
-- Payments (M-Pesa STK Push) and the money ledger
-- ---------------------------------------------------------------------------
create table public.payments (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders (id) on delete cascade,
  provider             text not null default 'mpesa' check (provider in ('mpesa')),
  method               text not null default 'stk_push',
  phone                text not null check (phone ~ '^254[17][0-9]{8}$'),
  amount_kes           integer not null check (amount_kes > 0),
  status               public.payment_status not null default 'requested',
  merchant_request_id  text,
  checkout_request_id  text unique,
  mpesa_receipt        text unique,
  result_code          integer,
  result_desc          text,
  callback             jsonb,
  requested_by         uuid references public.profiles (id) on delete set null,
  requested_at         timestamptz not null default now(),
  completed_at         timestamptz
);
create index payments_order_idx on public.payments (order_id, requested_at desc);

create table public.ledger_entries (
  id          bigint generated always as identity primary key,
  order_id    uuid references public.orders (id) on delete set null,
  farm_id     uuid not null references public.farms (id),
  kind        text not null check (kind in (
                'buyer_payment',   -- money in from the buyer (order total)
                'commission',      -- our share of that payment
                'farmer_payable',  -- farmer's share, held until the order completes
                'payout_due',      -- order completed: farmer's share is now owed
                'payout_sent',     -- we paid the farmer (reference = M-Pesa receipt)
                'refund_due',      -- paid order cancelled/declined: buyer is owed
                'refund_sent')),   -- buyer refunded
  amount_kes  numeric(12, 2) not null check (amount_kes >= 0),
  reference   text,
  actor_id    uuid,
  created_at  timestamptz not null default now()
);
create index ledger_farm_idx on public.ledger_entries (farm_id, created_at);
create index ledger_order_idx on public.ledger_entries (order_id);

-- ---------------------------------------------------------------------------
-- Reviews (one per completed order)
-- ---------------------------------------------------------------------------
create table public.reviews (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null unique references public.orders (id) on delete cascade,
  farm_id     uuid not null references public.farms (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  author_name text check (char_length(author_name) <= 60),
  rating      smallint not null check (rating between 1 and 5),
  body        text check (char_length(body) <= 1000),
  created_at  timestamptz not null default now()
);
create index reviews_farm_idx on public.reviews (farm_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Messaging: one conversation per buyer and farm; messages are append-only.
-- kind = 'order' rows are written by the system when an order changes.
-- ---------------------------------------------------------------------------
create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  farm_id          uuid not null references public.farms (id) on delete cascade,
  buyer_id         uuid not null references public.profiles (id) on delete cascade,
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz,
  unique (farm_id, buyer_id)
);
create index conversations_buyer_idx on public.conversations (buyer_id, last_message_at desc);
create index conversations_farm_idx on public.conversations (farm_id, last_message_at desc);

create table public.messages (
  id               bigint generated always as identity primary key,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  sender_id        uuid references public.profiles (id) on delete set null default auth.uid(),
  kind             text not null default 'text' check (kind in ('text', 'order')),
  body             text not null check (char_length(body) between 1 and 2000),
  order_id         uuid references public.orders (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, id);

create table public.conversation_reads (
  conversation_id       uuid not null references public.conversations (id) on delete cascade,
  user_id               uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  last_read_message_id  bigint not null default 0,
  updated_at            timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create or replace function public.is_conversation_participant(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.conversations c
    where c.id = cid and (c.buyer_id = auth.uid() or public.can_manage_farm(c.farm_id))
  );
$$;

create or replace function public.messages_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return null;
end;
$$;

create trigger messages_after_insert
  after insert on public.messages
  for each row execute function public.messages_after_insert();

create or replace function public.messages_before_insert()
returns trigger
language plpgsql
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

create trigger messages_before_insert
  before insert on public.messages
  for each row execute function public.messages_before_insert();

-- ---------------------------------------------------------------------------
-- Status history + order notes in the conversation, on every status change
-- ---------------------------------------------------------------------------
create or replace function public.orders_record_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.order_status_history (order_id, from_status, to_status, actor_id, note)
    values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status, auth.uid(),
            nullif(current_setting('i12farm.status_note', true), ''));

    insert into public.conversations (farm_id, buyer_id) values (new.farm_id, new.buyer_id)
    on conflict (farm_id, buyer_id) do nothing;
    select c.id into cid from public.conversations c where c.farm_id = new.farm_id and c.buyer_id = new.buyer_id;
    insert into public.messages (conversation_id, sender_id, kind, body, order_id)
    values (cid, null, 'order', new.status::text, new.id);
  end if;
  return null;
end;
$$;

create trigger orders_record_status
  after insert or update of status on public.orders
  for each row execute function public.orders_record_status();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.orders               enable row level security;
alter table public.order_items          enable row level security;
alter table public.order_status_history enable row level security;
alter table public.payments             enable row level security;
alter table public.ledger_entries       enable row level security;
alter table public.reviews              enable row level security;
alter table public.conversations        enable row level security;
alter table public.messages             enable row level security;
alter table public.conversation_reads   enable row level security;

-- Orders and everything under them: buyer, the farm's managers, admins.
-- All writes go through the functions below.
revoke all on public.orders, public.order_items, public.order_status_history, public.payments, public.ledger_entries
  from anon;
revoke insert, update, delete on public.orders, public.order_items, public.order_status_history, public.payments, public.ledger_entries
  from authenticated;

create or replace function public.can_see_order(oid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.orders o
    where o.id = oid and (o.buyer_id = auth.uid() or public.can_manage_farm(o.farm_id) or public.has_role('admin'))
  );
$$;

create policy "buyer, farm and admins read orders" on public.orders
  for select to authenticated
  using (buyer_id = auth.uid() or public.can_manage_farm(farm_id) or public.has_role('admin'));
create policy "order items follow the order" on public.order_items
  for select to authenticated using (public.can_see_order(order_id));
create policy "order history follows the order" on public.order_status_history
  for select to authenticated using (public.can_see_order(order_id));
create policy "payments follow the order" on public.payments
  for select to authenticated using (public.can_see_order(order_id));
create policy "farm managers and admins read the ledger" on public.ledger_entries
  for select to authenticated using (public.can_manage_farm(farm_id) or public.has_role('admin'));

-- Reviews are public on published farms; written only via leave_review().
revoke insert, update, delete on public.reviews from anon, authenticated;
create policy "reviews of published farms are public" on public.reviews
  for select using (exists (select 1 from public.farms f where f.id = farm_id and f.status = 'published'));

-- Messaging: participants only.
revoke all on public.conversations, public.messages, public.conversation_reads from anon;
revoke insert, update, delete on public.conversations from authenticated;
revoke update, delete on public.messages from authenticated;
create policy "participants read conversations" on public.conversations
  for select to authenticated using (buyer_id = auth.uid() or public.can_manage_farm(farm_id));
create policy "participants read messages" on public.messages
  for select to authenticated using (public.is_conversation_participant(conversation_id));
create policy "participants send text messages" on public.messages
  for insert to authenticated
  with check (sender_id = auth.uid() and kind = 'text' and order_id is null
              and public.is_conversation_participant(conversation_id));
create policy "own read markers" on public.conversation_reads
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_conversation_participant(conversation_id));

-- 0712 345 678 / +254 712 345 678 / 712345678 → 254712345678 (null if not a Kenyan mobile)
create or replace function public.normalise_ke_phone(raw text)
returns text
language sql
immutable
as $$
  select case
    when d ~ '^254[17][0-9]{8}$' then d
    when d ~ '^0[17][0-9]{8}$'   then '254' || substr(d, 2)
    when d ~ '^[17][0-9]{8}$'    then '254' || d
  end
  from (select regexp_replace(coalesce(raw, ''), '\D', '', 'g') as d) x;
$$;

-- ---------------------------------------------------------------------------
-- place_order: buyer sends listing ids and whole quantities; prices,
-- commission and totals are computed here from the live listings.
-- payload: { farm_id, items: [{listing_id, quantity}], fulfilment, delivery_note, buyer_name, buyer_phone }
-- ---------------------------------------------------------------------------
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

  -- Order number: 6 hex digits, retried on the rare collision.
  loop
    onum := upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from public.orders o where o.number = onum);
  end loop;

  -- Insert the order first (FK target for items), then correct its totals.
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
    insert into public.order_items (order_id, listing_id, product_slug, title, unit, unit_price_kes, quantity, line_total_kes)
    values (oid, l.id, l.product_slug, l.title, l.unit, l.price_kes, qty, l.price_kes * qty);
    total := total + l.price_kes * qty;
  end loop;

  if total < public.setting_int('min_order_kes', 50) then
    raise exception 'The smallest order is KES %', public.setting_int('min_order_kes', 50) using errcode = '22023';
  end if;
  if total > 250000 then
    raise exception 'M-Pesa takes at most KES 250,000 per payment; split the order' using errcode = '22023';
  end if;

  fee := round(total * bps / 10000.0, 0);
  update public.orders o
     set subtotal_kes = total, commission_kes = fee, farmer_payout_kes = total - fee
   where o.id = oid;

  return query select oid, onum, total;
end;
$$;
revoke execute on function public.place_order(jsonb) from public, anon;
grant execute on function public.place_order(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- set_order_status: who may move an order where
--   buyer:          awaiting_payment → cancelled;  ready → completed (received)
--   farm managers:  paid → accepted | declined;  accepted → ready | declined
--   admins:         anything a buyer or farm may do, plus paid/accepted/ready → cancelled
-- Completing makes the farmer's share due; cancelling or declining a paid
-- order makes a refund due.
-- ---------------------------------------------------------------------------
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

  perform set_config('i12farm.status_note', coalesce(left(note, 500), ''), true);
  update public.orders x
     set status = to_status,
         completed_at = case when to_status = 'completed' then now() else x.completed_at end,
         cancelled_at = case when to_status in ('cancelled', 'declined') then now() else x.cancelled_at end
   where x.id = oid;
  perform set_config('i12farm.status_note', '', true);

  if to_status = 'completed' then
    insert into public.ledger_entries (order_id, farm_id, kind, amount_kes, actor_id)
    values (oid, o.farm_id, 'payout_due', o.farmer_payout_kes, me);
  elsif to_status in ('cancelled', 'declined') and o.paid_at is not null then
    insert into public.ledger_entries (order_id, farm_id, kind, amount_kes, actor_id)
    values (oid, o.farm_id, 'refund_due', o.subtotal_kes, me);
  end if;

  return to_status;
end;
$$;
revoke execute on function public.set_order_status(uuid, public.order_status, text) from public, anon;
grant execute on function public.set_order_status(uuid, public.order_status, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Payments: the server records the STK request, then the M-Pesa result.
-- Neither function is callable by users.
-- ---------------------------------------------------------------------------
create or replace function public.record_payment_request(
  oid uuid, phone text, amount integer, merchant_id text, checkout_id text, by_user uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid;
begin
  insert into public.payments (order_id, phone, amount_kes, merchant_request_id, checkout_request_id, requested_by)
  values (oid, phone, amount, merchant_id, checkout_id, by_user)
  returning id into pid;
  return pid;
end;
$$;

create or replace function public.record_payment_result(
  checkout_id text, code integer, descr text, receipt text, paid_amount numeric, raw jsonb
)
returns text   -- 'paid' | 'already_final' | 'failed' | 'unknown' | 'underpaid' | 'paid_after_cancel'
language plpgsql
security definer
set search_path = public
as $$
declare
  p   public.payments;
  o   public.orders;
  l   record;
begin
  select * into p from public.payments x where x.checkout_request_id = checkout_id for update;
  if not found then
    return 'unknown';
  end if;
  if p.status <> 'requested' then
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

  select * into o from public.orders x where x.id = p.order_id for update;

  insert into public.ledger_entries (order_id, farm_id, kind, amount_kes, reference)
  values (o.id, o.farm_id, 'buyer_payment', coalesce(paid_amount, p.amount_kes), receipt);

  if o.status <> 'awaiting_payment' then
    -- Paid after the buyer cancelled, or a second payment: refund it.
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

  -- Take the sold quantities off the listings (recorded in price_history).
  for l in select i.listing_id, i.quantity from public.order_items i where i.order_id = o.id and i.listing_id is not null loop
    update public.listings x
       set quantity = greatest(x.quantity - l.quantity, 0),
           status = case when x.quantity is not null and x.quantity - l.quantity <= 0 then 'sold_out'::public.listing_status else x.status end
     where x.id = l.listing_id and x.quantity is not null;
  end loop;

  return 'paid';
end;
$$;

revoke execute on function public.record_payment_request(uuid, text, integer, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.record_payment_result(text, integer, text, text, numeric, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Payouts and refunds (admin records money sent; the ledger keeps the rest)
-- ---------------------------------------------------------------------------
create or replace function public.farm_balance(fid uuid)
returns table (pending_kes numeric, due_kes numeric, paid_out_kes numeric, completed_orders bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.can_manage_farm(fid) or public.has_role('admin')) then
    return;   -- no rows for anyone else
  end if;
  return query
    select
      -- paid, not yet completed: the farmer's share is held
      coalesce((select sum(o.farmer_payout_kes) from public.orders o
                 where o.farm_id = fid and o.status in ('paid', 'accepted', 'ready')), 0),
      coalesce(sum(e.amount_kes) filter (where e.kind = 'payout_due'), 0)
        - coalesce(sum(e.amount_kes) filter (where e.kind = 'payout_sent'), 0),
      coalesce(sum(e.amount_kes) filter (where e.kind = 'payout_sent'), 0),
      count(*) filter (where e.kind = 'payout_due')
    from public.ledger_entries e
    where e.farm_id = fid;
end;
$$;
revoke execute on function public.farm_balance(uuid) from public, anon;
grant execute on function public.farm_balance(uuid) to authenticated;

create or replace function public.admin_payouts_due()
returns table (farm_id uuid, farm_name text, slug text, payout_phone text, due_kes numeric, orders bigint, oldest_due timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return query
    select f.id, f.name, f.slug, coalesce(f.whatsapp, f.phone_public),
           sum(e.amount_kes) filter (where e.kind = 'payout_due') - coalesce(sum(e.amount_kes) filter (where e.kind = 'payout_sent'), 0),
           count(*) filter (where e.kind = 'payout_due'),
           min(e.created_at) filter (where e.kind = 'payout_due')
    from public.ledger_entries e
    join public.farms f on f.id = e.farm_id
    group by f.id
    having coalesce(sum(e.amount_kes) filter (where e.kind = 'payout_due'), 0)
         - coalesce(sum(e.amount_kes) filter (where e.kind = 'payout_sent'), 0) > 0
    order by 7;
end;
$$;

create or replace function public.admin_refunds_due()
returns table (order_id uuid, number text, farm_name text, buyer_phone text, due_kes numeric, since timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return query
    select o.id, o.number, f.name, o.buyer_phone,
           sum(e.amount_kes) filter (where e.kind = 'refund_due') - coalesce(sum(e.amount_kes) filter (where e.kind = 'refund_sent'), 0),
           min(e.created_at)
    from public.ledger_entries e
    join public.orders o on o.id = e.order_id
    join public.farms f on f.id = o.farm_id
    group by o.id, f.name
    having coalesce(sum(e.amount_kes) filter (where e.kind = 'refund_due'), 0)
         - coalesce(sum(e.amount_kes) filter (where e.kind = 'refund_sent'), 0) > 0
    order by 6;
end;
$$;

create or replace function public.admin_record_payout(fid uuid, amount numeric, ref text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  due numeric;
begin
  perform public.require_admin();
  if coalesce(trim(ref), '') = '' then
    raise exception 'Add the M-Pesa or bank reference' using errcode = '22023';
  end if;
  select coalesce(sum(amount_kes) filter (where kind = 'payout_due'), 0) - coalesce(sum(amount_kes) filter (where kind = 'payout_sent'), 0)
    into due from public.ledger_entries where farm_id = fid;
  if amount <= 0 or amount > due then
    raise exception 'Payout must be between 1 and the KES % due', due using errcode = '22023';
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

revoke execute on function public.admin_payouts_due() from public, anon;
revoke execute on function public.admin_refunds_due() from public, anon;
revoke execute on function public.admin_record_payout(uuid, numeric, text) from public, anon;
revoke execute on function public.admin_record_refund(uuid, text) from public, anon;

-- ---------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------
create or replace function public.leave_review(oid uuid, stars integer, review text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  o    public.orders;
  rid  uuid;
  who  text;
begin
  select * into o from public.orders x where x.id = oid;
  if not found or o.buyer_id is distinct from auth.uid() then
    raise exception 'Only the buyer can review this order' using errcode = '42501';
  end if;
  if o.status <> 'completed' then
    raise exception 'Reviews open once the order is completed' using errcode = '42501';
  end if;
  if stars not between 1 and 5 then
    raise exception 'Rating must be 1 to 5' using errcode = '22023';
  end if;
  -- Public name: first name and initial, e.g. "Achieng O."
  select trim(split_part(coalesce(p.full_name, ''), ' ', 1) || ' ' ||
              coalesce(nullif(left(split_part(coalesce(p.full_name, ''), ' ', 2), 1), '') || '.', ''))
    into who from public.profiles p where p.id = o.buyer_id;
  insert into public.reviews (order_id, farm_id, author_id, author_name, rating, body)
  values (oid, o.farm_id, o.buyer_id, nullif(who, ''), stars, nullif(trim(review), ''))
  returning id into rid;
  return rid;
exception when unique_violation then
  raise exception 'You already reviewed this order' using errcode = '23505';
end;
$$;
revoke execute on function public.leave_review(uuid, integer, text) from public, anon;
grant execute on function public.leave_review(uuid, integer, text) to authenticated;

create or replace function public.farm_rating(fid uuid)
returns table (avg_rating numeric, reviews bigint)
language sql
stable
set search_path = public
as $$
  select round(avg(rating)::numeric, 1), count(*) from public.reviews where farm_id = fid;
$$;

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------
create or replace function public.open_conversation(fid uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me  uuid := auth.uid();
  cid uuid;
begin
  if me is null then
    raise exception 'Sign in to message a farm' using errcode = '42501';
  end if;
  if not exists (select 1 from public.farms f where f.id = fid and f.status = 'published') then
    raise exception 'No such farm' using errcode = 'P0002';
  end if;
  if public.can_manage_farm(fid) then
    raise exception 'This is your own farm' using errcode = '42501';
  end if;
  insert into public.conversations (farm_id, buyer_id) values (fid, me)
  on conflict (farm_id, buyer_id) do nothing;
  select c.id into cid from public.conversations c where c.farm_id = fid and c.buyer_id = me;
  return cid;
end;
$$;
revoke execute on function public.open_conversation(uuid) from public, anon;
grant execute on function public.open_conversation(uuid) to authenticated;

-- Inbox rows for the signed-in user: as a buyer, and for every farm they manage.
create or replace function public.my_conversations()
returns table (
  id               uuid,
  farm_id          uuid,
  farm_name        text,
  farm_slug        text,
  i_am_buyer       boolean,
  other_name       text,
  last_message_at  timestamptz,
  last_body        text,
  last_kind        text,
  unread           integer
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, f.id, f.name, f.slug,
         c.buyer_id = auth.uid(),
         case when c.buyer_id = auth.uid() then coalesce(f.farmer_name, f.name)
              else coalesce(nullif(p.full_name, ''), 'Buyer') end,
         c.last_message_at, m.body, m.kind,
         (select count(*)::integer from public.messages x
           where x.conversation_id = c.id
             and x.id > coalesce((select r.last_read_message_id from public.conversation_reads r
                                   where r.conversation_id = c.id and r.user_id = auth.uid()), 0)
             and x.sender_id is distinct from auth.uid())
  from public.conversations c
  join public.farms f on f.id = c.farm_id
  left join public.profiles p on p.id = c.buyer_id
  left join lateral (
    select x.body, x.kind from public.messages x where x.conversation_id = c.id order by x.id desc limit 1
  ) m on true
  where auth.uid() is not null
    and (c.buyer_id = auth.uid() or public.can_manage_farm(c.farm_id))
    and c.last_message_at is not null
  order by c.last_message_at desc
  limit 100;
$$;
revoke execute on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;

-- ---------------------------------------------------------------------------
-- Map and search, now with ratings (replaces the Phase 1 versions)
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
  id             uuid,
  slug           text,
  name           text,
  farmer_name    text,
  categories     text[],
  county_code    smallint,
  county_name    text,
  place_name     text,
  lng            double precision,
  lat            double precision,
  verified       boolean,
  cover_path     text,
  min_price_kes  numeric,
  min_price_unit text,
  listing_count  integer,
  rating         numeric,
  review_count   integer
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
         r.avg_rating, r.n
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
  order by f.verified_at is not null desc, f.published_at desc
  limit least(greatest(max_rows, 1), 1000);
$$;

create or replace function public.search_farms(
  q               text,
  category_filter text[] default null,
  county_filter   smallint default null,
  max_rows        integer default 50
)
returns table (
  id             uuid,
  slug           text,
  name           text,
  farmer_name    text,
  categories     text[],
  county_code    smallint,
  county_name    text,
  place_name     text,
  lng            double precision,
  lat            double precision,
  verified       boolean,
  cover_path     text,
  min_price_kes  numeric,
  min_price_unit text,
  listing_count  integer,
  rating         numeric,
  review_count   integer
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
         r.avg_rating, r.n
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
  order by f.verified_at is not null desc, f.published_at desc
  limit least(greatest(max_rows, 1), 200);
$$;

grant execute on function public.farms_in_bbox(double precision, double precision, double precision, double precision, text[], smallint, integer) to anon, authenticated;
grant execute on function public.search_farms(text, text[], smallint, integer) to anon, authenticated;
