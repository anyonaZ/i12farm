-- i12farm · schema and row-level security tests
-- Run after migrations + seed. Each block raises 'FAIL: …' on a broken rule.
-- Usage: psql -v ON_ERROR_STOP=1 -f security_test.sql

\set farmer   '00000000-0000-4000-8000-0000000000f1'
\set agent    '00000000-0000-4000-8000-0000000000a1'
\set farm1    '10000000-0000-4000-8000-000000000001'
\set farm2    '10000000-0000-4000-8000-000000000002'
\set farm3    '10000000-0000-4000-8000-000000000003'

-- Superuser setup for tests: a draft farm owned by the farmer.
reset role;
insert into public.farms (id, owner_id, name, categories, county_code, status)
values ('10000000-0000-4000-8000-0000000000d1', :'farmer', 'Draft Shamba', '{vegetables}', 43, 'draft');
insert into public.listings (farm_id, type, title, unit, price_kes)
values ('10000000-0000-4000-8000-0000000000d1', 'produce', 'Draft greens', 'kg', 40);

-- ===========================================================================
-- Anonymous visitor
-- ===========================================================================
set role anon;
select set_config('request.jwt.claims', '', false);

do $$ begin
  if (select count(*) from public.farms) <> 8 then
    raise exception 'FAIL: anon should see exactly the 8 published farms, saw %', (select count(*) from public.farms);
  end if;
  if exists (select 1 from public.farms where name = 'Draft Shamba') then
    raise exception 'FAIL: anon can see a draft farm';
  end if;
  if exists (select 1 from public.listings where title = 'Draft greens') then
    raise exception 'FAIL: anon can see a listing on a draft farm';
  end if;
  raise notice 'ok  anon sees only published farms and their listings';
end $$;

do $$ begin
  perform 1 from public.farm_locations;
  raise exception 'FAIL: anon can read exact farm locations';
exception when insufficient_privilege then
  raise notice 'ok  anon cannot read exact locations';
end $$;

do $$
declare
  approx_x double precision; approx_y double precision;
begin
  select extensions.st_x(public_location::extensions.geometry), extensions.st_y(public_location::extensions.geometry)
    into approx_x, approx_y
  from public.farms where id = '10000000-0000-4000-8000-000000000002';
  -- exact point is (34.410, -0.512); approximate must move it but stay within ~1 km
  if approx_x = 34.410 and approx_y = -0.512 then
    raise exception 'FAIL: approximate pin equals the exact point';
  end if;
  if abs(approx_x - 34.410) > 0.0051 or abs(approx_y + 0.512) > 0.0051 then
    raise exception 'FAIL: approximate pin moved too far: % %', approx_x, approx_y;
  end if;

  select extensions.st_x(public_location::extensions.geometry) into approx_x
  from public.farms where id = '10000000-0000-4000-8000-000000000003';
  if abs(approx_x - 34.590) > 0.000001 then
    raise exception 'FAIL: exact-visibility pin should match the exact point, got %', approx_x;
  end if;
  raise notice 'ok  approximate pins are snapped (~1 km), exact pins are exact';
end $$;

do $$
declare n integer;
begin
  select count(*) into n from public.farms_in_bbox(34.0, -1.0, 34.8, -0.3);           -- Homa Bay area
  if n <> 5 then raise exception 'FAIL: farms_in_bbox(Homa Bay) expected 5, got %', n; end if;
  select count(*) into n from public.farms_in_bbox(34.0, -1.0, 35.2, 0.2, array['vet-services']);
  if n <> 1 then raise exception 'FAIL: category filter expected 1 vet, got %', n; end if;
  raise notice 'ok  farms_in_bbox filters by area and category';
end $$;

do $$ begin
  insert into public.contact_events (farm_id, channel, anonymous_id)
  values ('10000000-0000-4000-8000-000000000002', 'whatsapp', 'anon-test-1');
  raise notice 'ok  anon can log a contact on a published farm';
end $$;

do $$ begin
  insert into public.contact_events (farm_id, channel, anonymous_id)
  values ('10000000-0000-4000-8000-0000000000d1', 'call', 'anon-test-1');
  raise exception 'FAIL: anon logged a contact on a draft farm';
exception when insufficient_privilege then
  raise notice 'ok  contacts on draft farms are refused';
end $$;

do $$ begin
  perform 1 from public.contact_events;
  raise exception 'FAIL: anon can read contact events';
exception when insufficient_privilege then
  raise notice 'ok  anon cannot read contact events';
end $$;

do $$ begin
  insert into public.events (name, anonymous_id, properties) values ('page.view', 'anon-test-1', '{"path":"/"}');
  raise notice 'ok  anon can append an event';
end $$;

do $$ begin
  insert into public.events (name, anonymous_id, user_id)
  values ('page.view', 'anon-test-1', '00000000-0000-4000-8000-0000000000f1');
  raise exception 'FAIL: anon logged an event as another user';
exception when insufficient_privilege or with_check_option_violation then
  raise notice 'ok  events cannot be logged as someone else';
end $$;

do $$ begin
  if (select string_agg(name, ', ' order by name) from public.counties where is_pilot)
     <> 'Homa Bay, Kiambu, Kisumu, Migori, Nairobi' then
    raise exception 'FAIL: pilot counties are %', (select string_agg(name, ', ' order by name) from public.counties where is_pilot);
  end if;
  if (select count(*) from public.sub_counties where county_code in (22, 42, 43, 44, 47)) <> 52 then
    raise exception 'FAIL: expected 52 pilot sub-counties, got %', (select count(*) from public.sub_counties where county_code in (22, 42, 43, 44, 47));
  end if;
  raise notice 'ok  five pilot counties with all their sub-counties';
end $$;

-- ===========================================================================
-- Signed-in farmer (owns farm1, nothing else)
-- ===========================================================================
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}', false);

do $$ begin
  if not exists (select 1 from public.farms where name = 'Draft Shamba') then
    raise exception 'FAIL: owner cannot see their own draft farm';
  end if;
  if (select count(*) from public.farm_locations) <> 1 then
    raise exception 'FAIL: farmer should see exactly 1 exact location (their own), saw %', (select count(*) from public.farm_locations);
  end if;
  raise notice 'ok  owner sees own draft and only own exact location';
end $$;

do $$
declare n integer;
begin
  update public.farms set description = 'Friesians, 12 years' where id = '10000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: owner could not update own farm'; end if;

  update public.farms set description = 'hijacked' where id = '10000000-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: farmer updated someone else''s farm'; end if;
  raise notice 'ok  farmers edit only their own farm';
end $$;

do $$ begin
  update public.farms set verified_at = now() where id = '10000000-0000-4000-8000-000000000001';
  raise exception 'FAIL: farmer self-verified their farm';
exception when insufficient_privilege then
  raise notice 'ok  only admins verify farms';
end $$;

do $$ begin
  update public.profiles set roles = array['admin']::public.user_role[] where id = auth.uid();
  raise exception 'FAIL: user granted themselves a role';
exception when insufficient_privilege then
  raise notice 'ok  users cannot grant themselves roles';
end $$;

do $$
declare n integer;
begin
  update public.profiles set full_name = 'Dev Farmer Renamed', preferred_language = 'sw' where id = auth.uid();
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: user could not edit own profile'; end if;
  raise notice 'ok  users edit their own profile fields';
end $$;

do $$ begin
  update public.farms set public_location = 'SRID=4326;POINT(36.8 -1.28)' where id = '10000000-0000-4000-8000-000000000001';
  raise exception 'FAIL: client wrote public_location directly';
exception when insufficient_privilege then
  raise notice 'ok  public_location cannot be written by clients';
end $$;

do $$ begin
  update public.farms set visibility = 'hidden' where id = '10000000-0000-4000-8000-000000000001';
  if (select public_location from public.farms where id = '10000000-0000-4000-8000-000000000001') is not null then
    raise exception 'FAIL: hidden farm still has a public pin';
  end if;
  update public.farms set visibility = 'exact' where id = '10000000-0000-4000-8000-000000000001';
  if (select extensions.st_x(public_location::extensions.geometry) from public.farms
      where id = '10000000-0000-4000-8000-000000000001') <> 34.493 then
    raise exception 'FAIL: exact visibility did not restore the exact pin';
  end if;
  raise notice 'ok  visibility changes move the public pin';
end $$;

do $$ begin
  update public.farm_locations set location = 'SRID=4326;POINT(34.500 -0.550)'
  where farm_id = '10000000-0000-4000-8000-000000000001';
  if (select extensions.st_x(public_location::extensions.geometry) from public.farms
      where id = '10000000-0000-4000-8000-000000000001') <> 34.5 then
    raise exception 'FAIL: moving the exact pin did not update the public pin';
  end if;
  raise notice 'ok  moving the pin updates the map';
end $$;

do $$
declare n integer;
begin
  update public.listings set price_kes = 65 where farm_id = '10000000-0000-4000-8000-000000000001' and product_slug = 'fresh-milk';
  select count(*) into n from public.price_history ph
    join public.listings l on l.id = ph.listing_id
    where l.product_slug = 'fresh-milk' and ph.farm_id = '10000000-0000-4000-8000-000000000001';
  if n <> 2 then raise exception 'FAIL: expected 2 price_history rows for milk (create + change), got %', n; end if;
  raise notice 'ok  every price change is appended to price_history';
end $$;

do $$ begin
  insert into public.price_history (listing_id, farm_id, county_code, unit, status)
  select id, farm_id, 43, 'kg', 'active' from public.listings limit 1;
  raise exception 'FAIL: client wrote price_history directly';
exception when insufficient_privilege then
  raise notice 'ok  price_history is append-only via trigger';
end $$;

do $$ begin
  if (select count(*) from public.contact_events) <> 0 then
    raise exception 'FAIL: farmer sees contacts for farms they do not manage';
  end if;
  raise notice 'ok  farmers see only their own farm''s contacts';
end $$;

do $$ begin
  if (select count(*) from public.events) <> 0 then
    raise exception 'FAIL: non-admin can read the raw event log';
  end if;
  insert into public.events (name, user_id) values ('farm.edit', auth.uid());
  raise notice 'ok  raw events are admin-only; users log as themselves';
end $$;

do $$ begin
  insert into public.farms (owner_id, managed_by, name, categories, county_code)
  values (null, auth.uid(), 'Not my farm', '{dairy}', 43);
  raise exception 'FAIL: a non-agent created an agent-managed farm';
exception when insufficient_privilege or with_check_option_violation then
  raise notice 'ok  only field agents create farms for others';
end $$;

do $$ begin
  insert into public.farms (owner_id, name, categories, county_code)
  values (auth.uid(), 'Bad Category Farm', '{unicorns}', 43);
  raise exception 'FAIL: unknown category accepted';
exception when foreign_key_violation then
  raise notice 'ok  categories come from the fixed list';
end $$;

do $$ begin
  insert into storage.objects (bucket_id, name) values ('farm-media', 'farms/10000000-0000-4000-8000-000000000001/a.webp');
  raise notice 'ok  owner uploads photos to own farm folder';
end $$;

do $$ begin
  insert into storage.objects (bucket_id, name) values ('farm-media', 'farms/10000000-0000-4000-8000-000000000002/b.webp');
  raise exception 'FAIL: farmer uploaded into another farm''s folder';
exception when insufficient_privilege or with_check_option_violation then
  raise notice 'ok  photo uploads are limited to farms you manage';
end $$;

-- ===========================================================================
-- Field agent (manages farms 2–8, has the agent role)
-- ===========================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false);

do $$
declare fid uuid;
begin
  insert into public.farms (owner_id, managed_by, name, farmer_name, categories, county_code, status)
  values (null, auth.uid(), 'Kendu Bay Layers', 'Anyango R.', '{poultry}', 43, 'published')
  returning id into fid;
  insert into public.farm_locations (farm_id, location, source) values (fid, 'SRID=4326;POINT(34.640 -0.360)', 'agent');
  if (select public_location from public.farms where id = fid) is null then
    raise exception 'FAIL: agent-created farm has no public pin';
  end if;
  if (select slug from public.farms where id = fid) !~ '^kendu-bay-layers-[0-9a-f]{5}$' then
    raise exception 'FAIL: unexpected slug %', (select slug from public.farms where id = fid);
  end if;
  raise notice 'ok  agents pin farms for farmers without accounts';
end $$;

do $$ begin
  if (select count(*) from public.contact_events) <> 1 then
    raise exception 'FAIL: agent should see the 1 contact on a farm they manage, saw %', (select count(*) from public.contact_events);
  end if;
  raise notice 'ok  managers see contacts for farms they manage';
end $$;

do $$ begin
  update public.farms set status = 'suspended' where id = '10000000-0000-4000-8000-000000000002';
  raise exception 'FAIL: non-admin suspended a farm';
exception when insufficient_privilege then
  raise notice 'ok  only admins suspend farms';
end $$;

-- ===========================================================================
-- Phase 1: map, search, dashboard, pilot progress, saved farms, create_farm
-- ===========================================================================
set role anon;
select set_config('request.jwt.claims', '', false);

do $$
declare r record;
begin
  select * into r from public.farms_in_bbox(34.0, -1.0, 34.8, -0.3) where name = 'Lakeview Dairy';
  if r.min_price_kes is null or r.listing_count <> 2 or r.county_name <> 'Homa Bay' then
    raise exception 'FAIL: farm card fields wrong: price % listings % county %', r.min_price_kes, r.listing_count, r.county_name;
  end if;
  raise notice 'ok  map query returns cheapest price, listing count and county';
end $$;

do $$
declare n integer;
begin
  select count(*) into n from public.search_farms('honey');
  if n <> 1 then raise exception 'FAIL: search "honey" expected 1 farm, got %', n; end if;
  select count(*) into n from public.search_farms('asali');
  if n <> 1 then raise exception 'FAIL: Kiswahili search "asali" expected 1 farm, got %', n; end if;
  select count(*) into n from public.search_farms('kanyadoto poultry');
  if n <> 1 then raise exception 'FAIL: multi-word search expected 1, got %', n; end if;
  select count(*) into n from public.search_farms('draft');
  if n <> 0 then raise exception 'FAIL: search found a draft farm'; end if;
  raise notice 'ok  search matches products in English and Kiswahili, never drafts';
end $$;

do $$
declare n integer;
begin
  select coalesce(sum(farms), 0) into n from public.pilot_progress();
  if n < 9 then raise exception 'FAIL: pilot progress expected at least 9 published farms, got %', n; end if;
  if (select count(*) from public.pilot_progress()) <> 5 then raise exception 'FAIL: pilot progress should list 5 counties'; end if;
  raise notice 'ok  pilot progress counts published farms per pilot county';
end $$;

do $$ begin
  perform * from public.farm_stats('10000000-0000-4000-8000-000000000001');
  raise exception 'FAIL: anon read farm stats';
exception when insufficient_privilege then
  raise notice 'ok  farm stats need a signed-in manager';
end $$;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}', false);

do $$
declare r record;
begin
  select * into r from public.farm_stats('10000000-0000-4000-8000-000000000001');
  if r is null then raise exception 'FAIL: owner got no stats for own farm'; end if;
  if exists (select 1 from public.farm_stats('10000000-0000-4000-8000-000000000002')) then
    raise exception 'FAIL: farmer read stats for a farm they do not manage';
  end if;
  raise notice 'ok  farmers see stats only for their own farms';
end $$;

do $$ begin
  insert into public.saved_farms (farm_id) values ('10000000-0000-4000-8000-000000000003');
  if (select count(*) from public.saved_farms) <> 1 then raise exception 'FAIL: saved farm not visible to its owner'; end if;
  raise notice 'ok  buyers save farms';
end $$;

do $$
declare r record; loc_x double precision;
begin
  select * into r from public.create_farm('{
    "name": "Kendu Greens", "farmer_name": "Dev Farmer", "categories": ["vegetables"],
    "county_code": 43, "place_name": "Kendu Bay", "visibility": "approximate",
    "lng": 34.651, "lat": -0.371, "phone": "0712345678",
    "listings": [{"product_slug": "kale-sukuma", "price_kes": 45, "quantity": 100},
                 {"product_slug": "tomatoes", "price_kes": 90}]
  }'::jsonb);
  if r.slug !~ '^kendu-greens-' then raise exception 'FAIL: create_farm slug %', r.slug; end if;
  if (select count(*) from public.listings where farm_id = r.id) <> 2 then raise exception 'FAIL: create_farm listings'; end if;
  if (select owner_id from public.farms where id = r.id) <> auth.uid() then raise exception 'FAIL: create_farm owner'; end if;
  select extensions.st_x(public_location::extensions.geometry) into loc_x from public.farms where id = r.id;
  if loc_x is null or loc_x = 34.651 then raise exception 'FAIL: create_farm public pin should be approximate, got %', loc_x; end if;
  if (select count(*) from public.price_history where farm_id = r.id) <> 2 then raise exception 'FAIL: create_farm price history'; end if;
  raise notice 'ok  create_farm saves farm, pin, listings and price history together';
end $$;

do $$ begin
  perform * from public.create_farm('{"name": "Nowhere", "categories": ["dairy"], "county_code": 43, "lng": 10, "lat": 50}'::jsonb);
  raise exception 'FAIL: pin outside Kenya accepted';
exception when invalid_parameter_value then
  raise notice 'ok  pins outside Kenya are refused';
end $$;

do $$ begin
  perform * from public.create_farm('{"name": "Proxy Farm", "categories": ["dairy"], "county_code": 43, "lng": 34.5, "lat": -0.5, "for_farmer": true}'::jsonb);
  raise exception 'FAIL: a non-agent created a farm for someone else';
exception when insufficient_privilege or with_check_option_violation then
  raise notice 'ok  only agents enrol farms for other farmers';
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false);

do $$
declare r record;
begin
  select * into r from public.create_farm('{"name": "Oyugis Layers", "farmer_name": "Akinyi B.", "categories": ["poultry"], "county_code": 43, "lng": 34.73, "lat": -0.51, "for_farmer": true, "listings": [{"product_slug": "eggs", "price_kes": 440}]}'::jsonb);
  if (select managed_by from public.farms where id = r.id) <> auth.uid() then raise exception 'FAIL: agent-enrolled farm not managed by agent'; end if;
  if (select sum(mine) from public.pilot_progress()) < 1 then raise exception 'FAIL: agent progress missing'; end if;
  raise notice 'ok  agents enrol farms and see their own progress';
end $$;

-- ===========================================================================
-- Nightly rollup (runs as the database owner via pg_cron)
-- ===========================================================================
reset role;
select set_config('request.jwt.claims', '', false);

do $$
declare n integer;
begin
  update public.events set occurred_at = now() - interval '1 day';
  perform public.rollup_events((now() at time zone 'Africa/Nairobi')::date - 1);
  select coalesce(sum(events), 0) into n from public.events_daily;
  if n <> 2 then raise exception 'FAIL: rollup expected 2 events, got %', n; end if;
  raise notice 'ok  nightly rollup summarises events by day, name and county';
end $$;

\echo 'All security tests passed.'
