-- i12farm · Phase 3.5 · Hardening
-- * Paid orders the farm never answers: an SMS reminder, then an automatic
--   decline with the buyer's refund recorded as due.
-- * Search that forgives punctuation ("langata"), small typos ("chiken") and
--   finds farms by everyday words in English or Kiswahili ("milk", "mayai").
-- * Delete my account (data protection): personal details are removed, money
--   and order records are kept without the person's name or contact.
-- * Counts for the tab-bar badges.

-- ---------------------------------------------------------------------------
-- Paid orders nobody answers
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value, note) values
  ('paid_reminder_hours', '6',  'Hours after payment before the farm gets a reminder SMS to accept or decline.'),
  ('paid_decline_hours',  '36', 'Hours after payment before an unanswered order is declined and the buyer''s refund becomes due.')
on conflict (key) do nothing;

alter table public.orders add column if not exists farm_reminded_at timestamptz;

create or replace function public.run_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  days     integer := public.setting_int('auto_complete_days', 3);
  hours    integer := public.setting_int('unpaid_cancel_hours', 48);
  vet_h    integer := public.setting_int('vet_request_hours', 48);
  remind_h integer := public.setting_int('paid_reminder_hours', 6);
  drop_h   integer := public.setting_int('paid_decline_hours', 36);
  r        record;
  done     integer := 0;
  dropped  integer := 0;
  expired  integer := 0;
  ended    integer := 0;
  vets     integer := 0;
  stuck    integer := 0;
  reminded integer := 0;
  declined integer := 0;
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

  -- Paid but the farm has not answered: decline (refund due; the buyer gets an
  -- SMS from the orders trigger), else remind the farm once.
  for r in
    select o.id from public.orders o
    where o.status = 'paid' and o.paid_at < now() - make_interval(hours => drop_h)
    for update skip locked
  loop
    perform public.apply_order_status(r.id, 'declined', format('The farm did not answer within %s hours', drop_h), null);
    declined := declined + 1;
  end loop;

  for r in
    select o.id, o.number, o.farm_id, o.subtotal_kes from public.orders o
    where o.status = 'paid' and o.farm_reminded_at is null
      and o.paid_at < now() - make_interval(hours => remind_h)
    for update skip locked
  loop
    perform public.queue_sms(public.farm_alert_phone(r.farm_id), 'order_reminder',
      jsonb_build_object('number', r.number, 'total', round(r.subtotal_kes), 'hours', drop_h - remind_h),
      'transactional', r.id);
    update public.orders set farm_reminded_at = now() where id = r.id;
    reminded := reminded + 1;
  end loop;

  update public.payments p
     set status = 'expired', result_desc = 'No answer from M-Pesa', completed_at = now()
   where p.status = 'requested' and p.requested_at < now() - interval '1 hour';
  get diagnostics expired = row_count;

  update public.farm_promotions x set status = 'expired' where x.status = 'active' and x.ends_at <= now();
  get diagnostics ended = row_count;
  update public.farm_promotions x set status = 'cancelled'
   where x.status = 'awaiting_payment' and x.created_at < now() - interval '1 day';

  perform set_config('i12farm.via', 'system', true);
  update public.service_requests s set status = 'expired', closed_at = now()
   where s.status = 'open' and s.created_at < now() - make_interval(hours => vet_h);
  get diagnostics vets = row_count;

  update public.notifications n set status = 'failed', error = coalesce(n.error, 'Stuck while sending')
   where n.status = 'sending' and coalesce(n.sent_at, n.created_at) < now() - interval '1 hour';
  get diagnostics stuck = row_count;

  return jsonb_build_object('auto_completed', done, 'unpaid_cancelled', dropped,
                            'unanswered_reminded', reminded, 'unanswered_declined', declined,
                            'payments_expired', expired, 'promotions_ended', ended,
                            'vet_requests_expired', vets, 'sms_stuck', stuck, 'ran_at', now());
end;
$$;
revoke execute on function public.run_maintenance() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Search
-- ---------------------------------------------------------------------------
-- Everyday words → farm types, in both languages. Add rows freely.
create table public.search_aliases (
  term          text primary key check (term ~ '^[a-z0-9 ]{2,40}$'),
  category_slug text not null references public.farm_categories (slug)
);
alter table public.search_aliases enable row level security;
revoke insert, update, delete on public.search_aliases from anon, authenticated;
create policy "aliases readable" on public.search_aliases for select using (true);

insert into public.search_aliases (term, category_slug) values
  ('milk', 'dairy'), ('maziwa', 'dairy'), ('cow', 'dairy'), ('cows', 'dairy'), ('ngombe', 'dairy'), ('yoghurt', 'dairy'), ('mtindi', 'dairy'),
  ('egg', 'poultry'), ('eggs', 'poultry'), ('mayai', 'poultry'), ('chicken', 'poultry'), ('chickens', 'poultry'), ('kuku', 'poultry'),
  ('kienyeji', 'poultry'), ('broiler', 'poultry'), ('broilers', 'poultry'), ('layers', 'poultry'), ('chicks', 'poultry'), ('vifaranga', 'poultry'),
  ('pigeon', 'poultry'), ('pigeons', 'poultry'), ('njiwa', 'poultry'),
  ('goat', 'goats'), ('mbuzi', 'goats'), ('sheep', 'sheep'), ('kondoo', 'sheep'),
  ('pig', 'pigs'), ('pork', 'pigs'), ('piglet', 'pigs'), ('piglets', 'pigs'), ('nguruwe', 'pigs'),
  ('beef', 'beef'), ('bull', 'beef'), ('nyama', 'beef'), ('rabbit', 'rabbits'), ('sungura', 'rabbits'),
  ('fish', 'fish'), ('samaki', 'fish'), ('tilapia', 'fish'), ('catfish', 'fish'), ('fingerlings', 'fish'),
  ('honey', 'bees'), ('asali', 'bees'), ('bees', 'bees'), ('nyuki', 'bees'),
  ('vegetables', 'vegetables'), ('mboga', 'vegetables'), ('sukuma', 'vegetables'), ('kale', 'vegetables'), ('spinach', 'vegetables'),
  ('tomatoes', 'vegetables'), ('nyanya', 'vegetables'), ('cabbage', 'vegetables'), ('kabichi', 'vegetables'),
  ('fruit', 'fruits'), ('fruits', 'fruits'), ('matunda', 'fruits'), ('avocado', 'fruits'), ('parachichi', 'fruits'), ('mango', 'fruits'),
  ('maembe', 'fruits'), ('banana', 'fruits'), ('ndizi', 'fruits'),
  ('maize', 'grains'), ('mahindi', 'grains'), ('beans', 'grains'), ('maharagwe', 'grains'), ('rice', 'grains'), ('mchele', 'grains'),
  ('seedlings', 'seedlings'), ('miche', 'seedlings'), ('seeds', 'seedlings'), ('mbegu', 'seedlings'),
  ('feed', 'inputs'), ('feeds', 'inputs'), ('chakula', 'inputs'), ('hay', 'inputs'), ('fertiliser', 'inputs'), ('mbolea', 'inputs'),
  ('vet', 'vet-services'), ('vets', 'vet-services'), ('daktari', 'vet-services'), ('doctor', 'vet-services'), ('mifugo', 'vet-services'),
  ('ai', 'vet-services'), ('vaccination', 'vet-services'), ('chanjo', 'vet-services'),
  ('training', 'training'), ('mafunzo', 'training'), ('tour', 'training'), ('tours', 'training'), ('ziara', 'training')
on conflict (term) do nothing;

-- lower case, letters and digits only: "Lang'ata" → "langata", "Ng'ombe" → "ngombe"
create or replace function public.search_fold(t text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9\s]', '', 'g'), '\s+', ' ', 'g'));
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
    select array_remove(regexp_split_to_array(public.search_fold(q), ' '), '') as words
  ),
  hay as (
    select f.id as farm_id, f.categories,
           public.search_fold(concat_ws(' ', f.name, f.farmer_name, f.place_name, c.name, li.text, ca.text)) as text
    from public.farms f
    join public.counties c on c.code = f.county_code
    left join lateral (
      select string_agg(concat_ws(' ', l.title, pr.name_en, pr.name_sw), ' ') as text
      from public.listings l left join public.products pr on pr.slug = l.product_slug
      where l.farm_id = f.id and l.status in ('active', 'sold_out')
    ) li on true
    left join lateral (
      select string_agg(fc.name_en || ' ' || fc.name_sw, ' ') as text
      from public.farm_categories fc where fc.slug = any (f.categories)
    ) ca on true
    where f.status = 'published'
      and (category_filter is null or f.categories && category_filter)
      and (county_filter is null or f.county_code = county_filter)
  ),
  scored as (
    -- Every word must match: exactly (anywhere in the farm's text), through an
    -- alias for one of the farm's types, or (4+ letters) as a close spelling.
    select h.farm_id,
           sum(case when position(w in h.text) > 0 then 2
                    when exists (select 1 from public.search_aliases a where a.term = w and a.category_slug = any (h.categories)) then 2
                    when length(w) >= 5 and word_similarity(w, h.text) >= 0.45 then 1
                    when length(w) = 4 and word_similarity(w, h.text) >= 0.6 then 1
                    else -1000 end) as score
    from hay h, terms, unnest(terms.words) w
    where cardinality(terms.words) > 0
    group by h.farm_id
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
  from scored s
  join public.farms f on f.id = s.farm_id
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
  where s.score > 0
  order by s.score desc, public.farm_featured(f.id) desc, f.verified_at is not null desc, f.published_at desc
  limit least(greatest(max_rows, 1), 200);
$$;

-- ---------------------------------------------------------------------------
-- Delete my account
-- ---------------------------------------------------------------------------
alter table auth.users drop constraint users_status_check;
alter table auth.users add constraint users_status_check check (status in ('active', 'suspended', 'deleted'));
alter table auth.users drop constraint users_has_identifier;
alter table auth.users add constraint users_has_identifier check (status = 'deleted' or email is not null or phone is not null);

-- What stops a deletion: money still moving through the person's orders or farms.
create or replace function public.account_deletion_blockers()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'open_orders', (select count(*)::integer from public.orders o
                     where o.status in ('paid', 'accepted', 'ready')
                       and (o.buyer_id = auth.uid()
                            or o.farm_id in (select f.id from public.farms f where f.owner_id = auth.uid()))),
    'unpaid_balance', coalesce((select sum(b.due_kes) from public.farms f, lateral (
                                  select coalesce(sum(case when l.kind = 'payout_due' then l.amount_kes
                                                           when l.kind = 'payout_sent' then -l.amount_kes else 0 end), 0) as due_kes
                                  from public.ledger_entries l where l.farm_id = f.id) b
                                where f.owner_id = auth.uid()), 0),
    -- farms an agent enrolled for farmers who have not claimed them yet
    'managed_farms', (select count(*)::integer from public.farms f where f.managed_by = auth.uid() and f.owner_id is null));
$$;
revoke execute on function public.account_deletion_blockers() from public, anon;
grant execute on function public.account_deletion_blockers() to authenticated;

-- Removes the person's details. Orders, payments and the ledger stay (the law
-- and the farms need them) but no longer carry a name or phone. Farms the
-- person owns alone are hidden; farms an agent also manages go back to the agent.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  b  jsonb;
  ph text;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  b := public.account_deletion_blockers();
  if (b ->> 'open_orders')::integer > 0 then
    raise exception 'Finish or cancel your open orders first' using errcode = '55000';
  end if;
  if (b ->> 'managed_farms')::integer > 0 then
    raise exception 'Hand the farms you manage to another agent first (ask an admin)' using errcode = '55000';
  end if;
  if (b ->> 'unpaid_balance')::numeric > 0 then
    raise exception 'We still owe you money: wait for the payout first' using errcode = '55000';
  end if;
  select u.phone into ph from auth.users u where u.id = me;

  -- Farms
  update public.farms set owner_id = null where owner_id = me and managed_by is not null;
  update public.farms set status = 'draft', phone_public = null, whatsapp = null, farmer_name = null,
                          description = null, published_at = null
   where owner_id = me;
  delete from public.farm_locations where farm_id in (select id from public.farms where owner_id = me);
  update public.farms set managed_by = null where managed_by = me and owner_id is not null;

  -- Personal data
  delete from public.saved_farms where user_id = me;
  update public.messages set body = '[deleted]' where sender_id = me and kind = 'text';
  update public.orders set buyer_name = null, delivery_note = null where buyer_id = me;
  update public.service_requests set contact_name = null, description = null where requester_id = me;
  update public.profiles
     set full_name = null, phone = null, county_code = null, sub_county_id = null, ward_id = null,
         organisation = null, roles = array['buyer']::public.user_role[]
   where id = me;

  -- Sign-in
  delete from auth.identities where user_id = me;
  delete from auth.one_time_tokens where user_id = me;
  update auth.sessions set revoked_at = now(), revoked_reason = 'account_deleted' where user_id = me and revoked_at is null;
  update auth.users
     set email = null, phone = null, password_hash = null, meta = '{}'::jsonb, status = 'deleted',
         email_verified_at = null, phone_verified_at = null
   where id = me;
  insert into auth.audit_log (actor_id, target_id, action, details)
  values (me, me, 'account.deleted', jsonb_build_object('had_phone', ph is not null));
end;
$$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- Tab-bar badges
-- ---------------------------------------------------------------------------
create or replace function public.nav_counts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.uid() is null then '{}'::jsonb else jsonb_build_object(
    -- conversations with messages I haven't read
    'inbox', (select count(*)::integer from public.conversations c
               where (c.buyer_id = auth.uid() or public.can_manage_farm(c.farm_id))
                 and exists (select 1 from public.messages x
                              where x.conversation_id = c.id and x.sender_id is distinct from auth.uid()
                                and x.id > coalesce((select r.last_read_message_id from public.conversation_reads r
                                                      where r.conversation_id = c.id and r.user_id = auth.uid()), 0))),
    -- orders waiting for me: paid/accepted on my farms, ready to collect as a buyer
    'orders', (select count(*)::integer from public.orders o
                where (o.status in ('paid', 'accepted') and o.farm_id in
                         (select f.id from public.farms f where f.owner_id = auth.uid() or f.managed_by = auth.uid()))
                   or (o.status = 'ready' and o.buyer_id = auth.uid())),
    -- open vet requests in the counties of vet farms I manage
    'vets', (select count(*)::integer from public.service_requests s
              where s.status = 'open'
                and s.county_code in (select f.county_code from public.farms f
                                       where (f.owner_id = auth.uid() or f.managed_by = auth.uid())
                                         and f.status = 'published' and 'vet-services' = any (f.categories))))
  end;
$$;
revoke execute on function public.nav_counts() from public, anon;
grant execute on function public.nav_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- Farm links: "/f/lakeview-dairy" instead of "/f/lakeview-dairy-a49e2".
-- The short ending is added only when the name is already taken. Existing
-- links never change (they are already shared on WhatsApp).
-- ---------------------------------------------------------------------------
create or replace function public.farms_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  bad text;
  base text;
  syncing boolean := coalesce(current_setting('i12farm.syncing_location', true), 'off') = 'on';
begin
  if tg_op = 'INSERT' and (new.slug is null or new.slug = '') then
    base := left(trim(both '-' from regexp_replace(lower(new.name), '[^a-z0-9]+', '-', 'g')), 60);
    if base = '' then
      base := 'farm';
    end if;
    new.slug := base;
    while exists (select 1 from public.farms f where f.slug = new.slug) loop
      new.slug := base || '-' || substr(md5(gen_random_uuid()::text), 1, 5);
    end loop;
  end if;

  select c into bad
  from unnest(new.categories) as c
  where not exists (select 1 from public.farm_categories fc where fc.slug = c and fc.active)
  limit 1;
  if bad is not null then
    raise exception 'Unknown farm category: %', bad using errcode = '23503';
  end if;

  if new.status = 'published' and cardinality(new.categories) = 0 then
    raise exception 'A published farm needs at least one category' using errcode = '23514';
  end if;

  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    new.published_at := coalesce(new.published_at, now());
  end if;

  if not syncing then
    if tg_op = 'INSERT' then
      new.public_location := null;
    else
      new.public_location := old.public_location;
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Payout file: fall back to the farm owner's sign-in phone (M-Pesa) when the
-- farm has no public or WhatsApp number, so farmers who claimed their farm
-- can still be paid.
-- ---------------------------------------------------------------------------
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
    select f.id, f.name, f.slug,
           coalesce(f.whatsapp, f.phone_public, (select '+' || u.phone from auth.users u where u.id = f.owner_id)),
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
