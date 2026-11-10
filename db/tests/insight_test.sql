-- i12farm · Phase 4 tests: price index, benchmarks, search log, demand, county insight.
-- Runs after hardening_test.sql (scripts/test-db.sh), before the demo seed.

\set agent   '00000000-0000-4000-8000-0000000000a1'
\set buyer   '00000000-0000-4000-8000-0000000000b1'
\set partner '00000000-0000-4000-8000-0000000000c1'

reset role;
select set_config('app.user_id', '', false);

-- Three published farms in Migori (44) selling tilapia per kg at 400, 500, 900,
-- with a price change last week on the first one.
do $$
declare
  f uuid;
  l uuid;
  prices numeric[] := array[400, 500, 900];
  i integer;
begin
  for i in 1..3 loop
    insert into public.farms (managed_by, name, categories, county_code, status)
    values ('00000000-0000-4000-8000-0000000000a1', 'Insight Fish ' || i, '{fish}', 44, 'published') returning id into f;
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity)
    values (f, 'produce', 'tilapia', 'Tilapia', 'kg', prices[i], 10) returning id into l;
    if i = 1 then
      -- the listing existed two weeks ago at 300
      update public.price_history set observed_at = now() - interval '20 days' where listing_id = l;
      update public.listings set price_kes = 300 where id = l;
      update public.price_history set observed_at = now() - interval '15 days' where listing_id = l and price_kes = 300;
      update public.listings set price_kes = 400 where id = l;   -- today's price, recorded now
      perform set_config('test.fish1', l::text, false);
      perform set_config('test.farm1', f::text, false);
    end if;
  end loop;
  -- a draft farm's price never counts
  insert into public.farms (managed_by, name, categories, county_code, status)
  values ('00000000-0000-4000-8000-0000000000a1', 'Insight Draft', '{fish}', 44, 'draft') returning id into f;
  insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity)
  values (f, 'produce', 'tilapia', 'Tilapia', 'kg', 5, 10);
end $$;

set role anon;
do $$
declare
  now_wk date := date_trunc('week', now() at time zone 'Africa/Nairobi')::date;
  r record;
begin
  select * into r from public.price_index(44, 4, 'tilapia') where week = now_wk and unit = 'kg';
  if r.median_kes <> 500 or r.min_kes <> 400 or r.max_kes <> 900 or r.farms <> 3 then
    raise exception 'FAIL: this week''s Migori tilapia median %, min %, max %, farms % (want 500, 400, 900, 3)', r.median_kes, r.min_kes, r.max_kes, r.farms;
  end if;
  select * into r from public.price_index(44, 4, 'tilapia') where week = now_wk - 14 and unit = 'kg';
  if r.farms <> 1 or r.median_kes <> 300 then
    raise exception 'FAIL: two weeks ago only the first farm was selling, at 300 (got % farms, median %)', r.farms, r.median_kes;
  end if;
  raise notice 'ok  weekly county median from price history (drafts left out, earlier weeks use earlier prices)';

  if not exists (select 1 from public.price_benchmarks(current_setting('test.farm1')::uuid)
                 where listing_id = current_setting('test.fish1')::uuid and scope = 'county' and median_kes = 500 and farms = 3) then
    raise exception 'FAIL: price benchmark for the first fish farm';
  end if;
  raise notice 'ok  listings are compared with the county median when 3+ farms sell the same thing';
end $$;

-- Visitors can't read the raw logs.
do $$ begin
  perform 1 from public.search_log;
  raise exception 'FAIL: visitors can read the search log';
exception when insufficient_privilege then
  raise notice 'ok  the search log is not readable directly';
end $$;
do $$ begin
  perform public.search_demand(null, 30, false, 20);
  raise exception 'FAIL: visitors can see raw search terms';
exception when insufficient_privilege then
  raise notice 'ok  full search terms are for partners only';
end $$;

-- Logging searches (as a visitor)
select public.log_search('Kondoo!', null, null, 0, 'device-insight-1', 34.47, -1.07);  -- near Migori town
do $$ begin
  -- half-typed, then finished, by one device
  perform public.log_search('qua', 44, null, 2, 'device-insight-2');
  perform public.log_search('quail', 44, null, 0, 'device-insight-2');
  perform public.log_search('quail', 44, null, 0, 'device-insight-3');
  perform public.log_search('quail', 44, null, 0, 'device-insight-4');
  -- a phone number, searched by many
  perform public.log_search('0712 345678', 44, null, 0, 'device-insight-2');
  perform public.log_search('0712 345678', 44, null, 0, 'device-insight-3');
  perform public.log_search('0712 345678', 44, null, 0, 'device-insight-4');
  -- sheep: 3 devices
  perform public.log_search('sheep', 44, null, 0, 'device-insight-5');
  perform public.log_search('sheep', 44, null, 0, 'device-insight-6');
  -- too short / no device: ignored
  perform public.log_search('a', 44, null, 0, 'device-insight-7');
  perform public.log_search('sheep', 44, null, 0, null);
end $$;

reset role;
do $$ begin
  if (select county_code from public.search_log where term = 'kondoo') is distinct from 44 then
    raise exception 'FAIL: county not worked out from the map position';
  end if;
  if exists (select 1 from public.search_log where searcher like 'device%' or char_length(searcher) <> 32) then
    raise exception 'FAIL: device ids stored as given';
  end if;
  if (select count(*) from public.search_log where term = 'sheep') <> 2 then
    raise exception 'FAIL: searches without a device were logged';
  end if;
  raise notice 'ok  searches are logged with a hashed device id and the county being looked at';
end $$;

select public.log_search('sheep', 44, null, 0, 'device-insight-1');   -- 3rd sheep device ("kondoo" folds separately)

-- rate limit: the 61st search in an hour is ignored
do $$
declare i integer;
begin
  for i in 1..65 loop
    perform public.log_search('spam ' || i, 44, null, 0, 'device-insight-spam');
  end loop;
  if (select count(*) from public.search_log where term like 'spam %') <> 60 then
    raise exception 'FAIL: per-device limit not applied';
  end if;
  delete from public.search_log where term like 'spam %';
  raise notice 'ok  at most 60 searches an hour are logged per device';
end $$;

do $$
declare
  qu integer;
begin
  select searchers into qu from public.search_demand(44, 30, false, 50) where term = 'quail';
  if qu is distinct from 3 or exists (select 1 from public.search_demand(44, 30, false, 50) where term = 'qua') then
    raise exception 'FAIL: half-typed searches counted (quail %)', qu;
  end if;
  if exists (select 1 from public.search_demand(44, 30, false, 50) where term ~ '[0-9]{4}') then
    raise exception 'FAIL: phone numbers shown as demand';
  end if;
  if exists (select 1 from public.search_demand(44, 30, false, 50) where term = 'kondoo') then
    raise exception 'FAIL: a term searched by one device is shown';
  end if;
  if not exists (select 1 from public.unmet_demand(44) where term = 'sheep' and searchers = 3) then
    raise exception 'FAIL: unmet demand for sheep in Migori';
  end if;
  if exists (select 1 from public.unmet_demand(44) where term = 'quail') then
    raise exception 'FAIL: a word outside the farm vocabulary is shown publicly';
  end if;
  raise notice 'ok  demand: finished searches only, 3+ devices, no numbers; public list uses farm words only';
end $$;

-- County insight: partners and admins only
set role authenticated;
select set_config('app.user_id', :'buyer', false);
do $$ begin
  perform public.county_insight(44, 90);
  raise exception 'FAIL: a buyer can open county insight';
exception when insufficient_privilege then
  raise notice 'ok  county insight is for partners and admins';
end $$;

select set_config('app.user_id', :'partner', false);
do $$
declare
  j jsonb := public.county_insight(44, 90);
begin
  if (j -> 'farms' ->> 'published')::integer < 3 then
    raise exception 'FAIL: farm counts missing: %', j -> 'farms';
  end if;
  if not exists (select 1 from jsonb_array_elements(j -> 'on_sale') e where e ->> 'product' = 'tilapia' and (e ->> 'median_kes')::numeric = 500) then
    raise exception 'FAIL: on-sale medians missing: %', j -> 'on_sale';
  end if;
  if (j -> 'trade' ->> 'hidden')::boolean is not true or j -> 'trade' ? 'value_kes' then
    raise exception 'FAIL: fewer than 3 orders but trade figures shown: %', j -> 'trade';
  end if;
  if not exists (select 1 from jsonb_array_elements(j -> 'demand' -> 'unmet') e where e ->> 'term' = 'quail') then
    raise exception 'FAIL: partners should see unmet demand for quail';
  end if;
  raise notice 'ok  county insight: farms, prices, demand; trade withheld below 3 orders';
end $$;

reset role;
select set_config('app.user_id', '', false);
do $$
declare r jsonb;
begin
  update public.search_log set searched_at = now() - interval '200 days' where term = 'kondoo';
  r := public.run_maintenance();
  if (r ->> 'search_log_pruned')::integer < 1 or exists (select 1 from public.search_log where term = 'kondoo') then
    raise exception 'FAIL: old search log rows kept';
  end if;
  raise notice 'ok  search log rows older than 180 days are deleted';
end $$;

\echo 'All insight tests passed.'
