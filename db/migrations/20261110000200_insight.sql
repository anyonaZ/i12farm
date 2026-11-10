-- i12farm · Phase 4 · Insight
-- Read-only views of the market built from what the app already records:
--   * a county price index from price_history (weekly median per product),
--   * price benchmarks for listings ("county median"),
--   * demand signals: what buyers search for, and what they don't find,
--   * a county dashboard for partners (county offices, cooperatives, NGOs).
-- Everything here is aggregated. Counts that could point to a person (fewer
-- than `insight_min_count`, default 3) are withheld or folded into "other".

insert into public.platform_settings (key, value, note) values
  ('insight_min_count', '3', 'Smallest group shown on insight pages (searchers, orders, requests). Smaller groups are hidden so no one can be singled out.'),
  ('search_log_days',   '180', 'Days the anonymous search log is kept before it is deleted.')
on conflict (key) do nothing;

-- The price index looks up each listing's latest price before a date.
create index if not exists price_history_listing_time_idx on public.price_history (listing_id, observed_at desc);

-- ---------------------------------------------------------------------------
-- Search log: one row per search, for demand signals. No user id, no IP:
-- the searcher is a one-way hash of the device's random id, used only to count
-- distinct searchers and to drop the half-typed words of the same search.
-- ---------------------------------------------------------------------------
create table public.search_log (
  id           bigint generated always as identity primary key,
  searched_at  timestamptz not null default now(),
  term         text not null check (char_length(term) between 2 and 40),
  county_code  smallint references public.counties (code),
  category     text check (category ~ '^[a-z0-9-]{2,40}$'),
  results      integer not null check (results >= 0),
  searcher     text not null check (char_length(searcher) = 32)
);
create index search_log_county_time_idx on public.search_log (county_code, searched_at);
create index search_log_time_brin on public.search_log using brin (searched_at);
alter table public.search_log enable row level security;
revoke all on public.search_log from anon, authenticated;
-- No policies: read only through the functions below.

create or replace function public.log_search(
  p_term text, p_county integer, p_category text, p_results integer, p_device text,
  p_lng double precision default null, p_lat double precision default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  t   text := left(public.search_fold(p_term), 40);
  who text;
  cty integer := p_county;
begin
  if char_length(t) < 2 or p_device is null or char_length(p_device) not between 8 and 64 then
    return;
  end if;
  who := md5('i12farm-search:' || p_device);
  -- 60 searches an hour per device is plenty for a person; anything beyond is ignored.
  if (select count(*) from public.search_log s where s.searcher = who and s.searched_at > now() - interval '1 hour') >= 60 then
    return;
  end if;
  -- No county filter: use the county the buyer was looking at (nearest county
  -- centre to the middle of the map, within 80 km).
  if cty is null and p_lng between 28 and 46 and p_lat between -12 and 8 then
    select c.code into cty from public.counties c
     where c.focus_point is not null
       and extensions.st_dwithin(c.focus_point, extensions.st_makepoint(p_lng, p_lat)::extensions.geography, 80000)
     order by c.focus_point operator(extensions.<->) extensions.st_makepoint(p_lng, p_lat)::extensions.geography
     limit 1;
  end if;
  if cty is not null and not exists (select 1 from public.counties where code = cty) then
    cty := null;
  end if;
  insert into public.search_log (term, county_code, category, results, searcher)
  values (t, cty, case when p_category ~ '^[a-z0-9-]{2,40}$' then p_category end, greatest(coalesce(p_results, 0), 0), who);
end;
$$;
revoke execute on function public.log_search(text, integer, text, integer, text, double precision, double precision) from public;
grant execute on function public.log_search(text, integer, text, integer, text, double precision, double precision) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Price index: for each week, every listing's price in effect at the end of
-- that week (its latest change before then, if it was on sale), then the
-- median across farms. County, or all of Kenya when p_county is null.
-- Goods only (produce, livestock, inputs), published farms only.
-- ---------------------------------------------------------------------------
create or replace function public.price_index(p_county integer default null, p_weeks integer default 12, p_product text default null)
returns table (
  product_slug text, unit text, week date,
  median_kes numeric, min_kes numeric, max_kes numeric, farms integer
)
language sql
stable
security definer
set search_path = public
as $$
  with weeks as (
    select generate_series(
             date_trunc('week', now() at time zone 'Africa/Nairobi') - make_interval(weeks => least(greatest(p_weeks, 1), 52) - 1),
             date_trunc('week', now() at time zone 'Africa/Nairobi'),
             interval '1 week')::date as wk
  ),
  goods as (
    select l.id, l.farm_id
    from public.listings l
    join public.farms f on f.id = l.farm_id and f.status = 'published'
    where l.type in ('produce', 'livestock', 'input')
      and l.product_slug is not null
      and (p_county is null or f.county_code = p_county)
      and (p_product is null or l.product_slug = p_product)
  ),
  in_effect as (
    select w.wk, g.farm_id, h.product_slug, h.unit, h.price_kes, h.status
    from weeks w
    cross join goods g
    cross join lateral (
      select x.product_slug, x.unit, x.price_kes, x.status
      from public.price_history x
      where x.listing_id = g.id
        and x.observed_at < ((w.wk + 7)::timestamp at time zone 'Africa/Nairobi')
      order by x.observed_at desc
      limit 1
    ) h
  ),
  -- one price per farm per product and week (a farm with two listings of the same thing counts once)
  per_farm as (
    select wk, farm_id, product_slug, unit, min(price_kes) as price_kes
    from in_effect
    where status = 'active' and price_kes is not null
    group by wk, farm_id, product_slug, unit
  )
  select p.product_slug, p.unit, p.wk,
         round(percentile_cont(0.5) within group (order by p.price_kes)::numeric, 0),
         min(p.price_kes), max(p.price_kes), count(*)::integer
  from per_farm p
  group by p.product_slug, p.unit, p.wk
  order by p.product_slug, p.unit, p.wk;
$$;
revoke execute on function public.price_index(integer, integer, text) from public;
grant execute on function public.price_index(integer, integer, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Price benchmarks for one farm's listings: today's median for the same product
-- and unit in the farm's county, or across Kenya when the county has fewer than
-- `insight_min_count` farms selling it.
-- ---------------------------------------------------------------------------
create or replace function public.price_benchmarks(p_farm uuid)
returns table (listing_id uuid, scope text, median_kes numeric, farms integer)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select l.id, l.product_slug, l.unit, f.county_code
    from public.listings l join public.farms f on f.id = l.farm_id
    where l.farm_id = p_farm and f.status = 'published' and l.status = 'active'
      and l.type in ('produce', 'livestock', 'input') and l.product_slug is not null and l.price_kes is not null
  ),
  market as (
    select l.product_slug, l.unit, f.county_code, l.farm_id, min(l.price_kes) as price_kes
    from public.listings l join public.farms f on f.id = l.farm_id
    where f.status = 'published' and l.status = 'active' and l.price_kes is not null
      and l.product_slug in (select product_slug from mine)
    group by l.product_slug, l.unit, f.county_code, l.farm_id
  ),
  stats as (
    select m.id as listing_id,
           (select count(*) from market k where k.product_slug = m.product_slug and k.unit = m.unit and k.county_code = m.county_code)::integer as county_farms,
           (select percentile_cont(0.5) within group (order by k.price_kes) from market k
             where k.product_slug = m.product_slug and k.unit = m.unit and k.county_code = m.county_code) as county_median,
           (select count(*) from market k where k.product_slug = m.product_slug and k.unit = m.unit)::integer as kenya_farms,
           (select percentile_cont(0.5) within group (order by k.price_kes) from market k
             where k.product_slug = m.product_slug and k.unit = m.unit) as kenya_median
    from mine m
  )
  select s.listing_id,
         case when s.county_farms >= public.setting_int('insight_min_count', 3) then 'county' else 'kenya' end,
         round((case when s.county_farms >= public.setting_int('insight_min_count', 3) then s.county_median else s.kenya_median end)::numeric, 0),
         case when s.county_farms >= public.setting_int('insight_min_count', 3) then s.county_farms else s.kenya_farms end
  from stats s
  where s.kenya_farms >= public.setting_int('insight_min_count', 3);
$$;
revoke execute on function public.price_benchmarks(uuid) from public;
grant execute on function public.price_benchmarks(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Demand: searches in a county (or all of Kenya) over the last p_days.
-- Half-typed words are dropped (the same device searched a longer word that
-- starts with it within two minutes), terms with long numbers are dropped
-- (phone numbers), and a term shows only when at least `insight_min_count`
-- different devices searched it. p_public keeps only terms made of everyday
-- farm words (products, farm types, search words), for the public prices page.
-- ---------------------------------------------------------------------------
create or replace function public.search_demand(p_county integer default null, p_days integer default 30, p_public boolean default true, p_limit integer default 20)
returns table (term text, searchers integer, searches integer, zero_share numeric, typical_results integer)
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select * from public.search_log l
    where l.searched_at > now() - make_interval(days => least(greatest(p_days, 1), 365))
      and (p_county is null or l.county_code = p_county)
      and l.term !~ '[0-9]{4,}'
  ),
  finished as (
    select s.* from s
    where not exists (
      select 1 from s s2
      where s2.searcher = s.searcher and s2.id <> s.id
        and s2.searched_at between s.searched_at and s.searched_at + interval '2 minutes'
        and char_length(s2.term) > char_length(s.term)
        and left(s2.term, char_length(s.term)) = s.term
    )
  ),
  vocab as (
    select a.term as word from public.search_aliases a
    union select regexp_split_to_table(public.search_fold(p.name_en || ' ' || p.name_sw || ' ' || replace(p.slug, '-', ' ')), ' ') from public.products p
    union select regexp_split_to_table(public.search_fold(c.name_en || ' ' || c.name_sw || ' ' || replace(c.slug, '-', ' ')), ' ') from public.farm_categories c
  ),
  grouped as (
    select f.term, count(distinct f.searcher)::integer as searchers, count(*)::integer as searches,
           round(avg((f.results = 0)::integer)::numeric, 2) as zero_share,
           (percentile_disc(0.5) within group (order by f.results))::integer as typical_results
    from finished f
    group by f.term
    having count(distinct f.searcher) >= public.setting_int('insight_min_count', 3)
  )
  select g.* from grouped g
  where not p_public
     or not exists (select 1 from regexp_split_to_table(g.term, ' ') w(word) where w.word <> '' and w.word not in (select word from vocab))
  order by g.searchers desc, g.term
  limit least(greatest(p_limit, 1), 100);
$$;
revoke execute on function public.search_demand(integer, integer, boolean, integer) from public, anon, authenticated;

-- Public: only everyday farm words, only what buyers did not find (half or more of the searches found nothing).
create or replace function public.unmet_demand(p_county integer default null, p_days integer default 30)
returns table (term text, searchers integer)
language sql
stable
security definer
set search_path = public
as $$
  select d.term, d.searchers from public.search_demand(p_county, p_days, true, 100) d
  where d.zero_share >= 0.5
  order by d.searchers desc, d.term
  limit 12;
$$;
revoke execute on function public.unmet_demand(integer, integer) from public;
grant execute on function public.unmet_demand(integer, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- County dashboard for partners and admins. Everything aggregated; groups
-- smaller than `insight_min_count` are hidden or folded into "other".
-- ---------------------------------------------------------------------------
create or replace function public.county_insight(p_county integer default null, p_days integer default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  k     integer := public.setting_int('insight_min_count', 3);
  days  integer := least(greatest(coalesce(p_days, 90), 7), 365);
  since timestamptz := now() - make_interval(days => days);
  farms jsonb;
  goods jsonb;
  trade jsonb;
  vets  jsonb;
  taps  jsonb;
  wants jsonb;
  n     integer;
begin
  if auth.uid() is null or not (public.has_role('partner') or public.has_role('admin')) then
    raise exception 'County insight is for partner organisations' using errcode = '42501';
  end if;
  if p_county is not null and not exists (select 1 from public.counties where code = p_county) then
    raise exception 'No such county' using errcode = '22023';
  end if;

  -- Farms on the map (public already): totals and by farm type.
  select jsonb_build_object(
           'published', count(*) filter (where f.status = 'published'),
           'verified', count(*) filter (where f.status = 'published' and f.verified_at is not null),
           'new', count(*) filter (where f.status = 'published' and f.created_at > since),
           'by_type', coalesce((
             select jsonb_agg(jsonb_build_object('slug', x.slug, 'farms', x.n) order by x.n desc, x.slug)
             from (select unnest(f2.categories) as slug, count(*)::integer as n
                   from public.farms f2
                   where f2.status = 'published' and (p_county is null or f2.county_code = p_county)
                   group by 1) x), '[]'::jsonb))
    into farms
  from public.farms f
  where p_county is null or f.county_code = p_county;

  -- What is on sale now: listings and farms per product, with today's median.
  select coalesce(jsonb_agg(jsonb_build_object('product', x.product_slug, 'unit', x.unit, 'farms', x.farms, 'median_kes', x.median)
                            order by x.farms desc, x.product_slug), '[]'::jsonb)
    into goods
  from (
    select l.product_slug, l.unit, count(distinct l.farm_id)::integer as farms,
           round(percentile_cont(0.5) within group (order by l.price_kes)::numeric, 0) as median
    from public.listings l join public.farms f on f.id = l.farm_id
    where f.status = 'published' and l.status = 'active' and l.product_slug is not null and l.price_kes is not null
      and l.type in ('produce', 'livestock', 'input')
      and (p_county is null or f.county_code = p_county)
    group by l.product_slug, l.unit
    order by 3 desc, 1
    limit 15
  ) x;

  -- Orders paid through the app in the period (paid, accepted, ready, completed).
  select count(*)::integer into n from public.orders o
   where o.paid_at > since and o.status in ('paid', 'accepted', 'ready', 'completed')
     and (p_county is null or o.county_code = p_county);
  if n >= k then
    select jsonb_build_object(
             'orders', n,
             'value_kes', (select coalesce(sum(o.subtotal_kes), 0) from public.orders o
                            where o.paid_at > since and o.status in ('paid', 'accepted', 'ready', 'completed')
                              and (p_county is null or o.county_code = p_county)),
             'buyers', (select count(distinct coalesce(o.buyer_id::text, o.buyer_phone))  -- null when fewer than k buyers
                          from public.orders o
                         where o.paid_at > since and o.status in ('paid', 'accepted', 'ready', 'completed')
                           and (p_county is null or o.county_code = p_county)
                        having count(distinct coalesce(o.buyer_id::text, o.buyer_phone)) >= k),
             'farms', (select count(distinct o.farm_id) from public.orders o
                        where o.paid_at > since and o.status in ('paid', 'accepted', 'ready', 'completed')
                          and (p_county is null or o.county_code = p_county)),
             'top_products', coalesce((
               select jsonb_agg(jsonb_build_object('product', y.product_slug, 'orders', y.orders, 'value_kes', y.value) order by y.value desc)
               from (select i.product_slug, count(distinct o.id)::integer as orders, sum(i.line_total_kes) as value
                     from public.order_items i join public.orders o on o.id = i.order_id
                     where o.paid_at > since and o.status in ('paid', 'accepted', 'ready', 'completed')
                       and (p_county is null or o.county_code = p_county) and i.product_slug is not null
                     group by i.product_slug
                     having count(distinct o.id) >= k and count(distinct o.farm_id) >= 2
                     order by 3 desc limit 8) y), '[]'::jsonb),
             'hidden', false)
      into trade;
  else
    trade := jsonb_build_object('hidden', true, 'top_products', '[]'::jsonb);
  end if;

  -- Vet requests by animal; small groups go into "other".
  select jsonb_build_object(
           'total', coalesce(sum(x.n), 0),
           'answered', coalesce(sum(x.answered), 0),
           'by_animal', coalesce(jsonb_agg(jsonb_build_object('animal', x.animal, 'requests', x.n) order by x.n desc)
                                   filter (where x.animal is not null), '[]'::jsonb),
           'hidden', coalesce(sum(x.n), 0) < k)
    into vets
  from (
    select case when count(*) >= k then s.animal else 'other' end as animal,
           count(*)::integer as n,
           count(*) filter (where s.status in ('accepted', 'completed'))::integer as answered
    from public.service_requests s
    where s.created_at > since and (p_county is null or s.county_code = p_county)
    group by s.animal
  ) x;
  if (vets ->> 'hidden')::boolean then
    vets := jsonb_build_object('hidden', true, 'by_animal', '[]'::jsonb);
  else
    -- merge the several "other" rows into one
    vets := jsonb_set(vets, '{by_animal}', coalesce((
      select jsonb_agg(jsonb_build_object('animal', a.animal, 'requests', a.n) order by a.animal = 'other', a.n desc)
      from (select e ->> 'animal' as animal, sum((e ->> 'requests')::integer)::integer as n
            from jsonb_array_elements(vets -> 'by_animal') e group by 1) a), '[]'::jsonb));
  end if;

  -- Buyers getting in touch (Call, WhatsApp, Directions taps) with farms in the county.
  select jsonb_build_object('total', count(*), 'farms', count(distinct c.farm_id))
    into taps
  from public.contact_events c
  where c.created_at > since and (p_county is null or c.county_code = p_county);

  select jsonb_build_object(
           'searched', coalesce((select jsonb_agg(to_jsonb(d)) from public.search_demand(p_county, least(days, 90), false, 15) d), '[]'::jsonb),
           'unmet', coalesce((select jsonb_agg(to_jsonb(d)) from public.search_demand(p_county, least(days, 90), false, 100) d
                              where d.zero_share >= 0.5), '[]'::jsonb))
    into wants;

  return jsonb_build_object(
    'county', p_county, 'days', days, 'min_count', k, 'as_of', now(),
    'farms', farms, 'on_sale', goods, 'trade', trade, 'vets', vets, 'contacts', taps, 'demand', wants);
end;
$$;
revoke execute on function public.county_insight(integer, integer) from public, anon;
grant execute on function public.county_insight(integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Upkeep: as before, plus deleting old search log rows.
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
  vet_h    integer := public.setting_int('vet_request_hours', 48);
  drop_h   integer := public.setting_int('paid_decline_hours', 36);
  keep_d   integer := public.setting_int('search_log_days', 180);
  r        record;
  done     integer := 0;
  dropped  integer := 0;
  expired  integer := 0;
  ended    integer := 0;
  vets     integer := 0;
  declined integer := 0;
  pruned   integer := 0;
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

  for r in
    select o.id from public.orders o
    where o.status = 'paid' and o.paid_at < now() - make_interval(hours => drop_h)
    for update skip locked
  loop
    perform public.apply_order_status(r.id, 'declined', format('The farm did not answer within %s hours', drop_h), null);
    declined := declined + 1;
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

  delete from public.search_log l where l.searched_at < now() - make_interval(days => keep_d);
  get diagnostics pruned = row_count;

  return jsonb_build_object('auto_completed', done, 'unpaid_cancelled', dropped, 'unanswered_declined', declined,
                            'payments_expired', expired, 'promotions_ended', ended,
                            'vet_requests_expired', vets, 'search_log_pruned', pruned, 'ran_at', now());
end;
$$;
revoke execute on function public.run_maintenance() from public, anon, authenticated;
