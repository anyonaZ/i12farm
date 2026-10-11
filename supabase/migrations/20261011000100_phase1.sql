-- i12farm · Phase 1 · Be seen
-- Map and search queries, farmer dashboard counts, pilot enrolment progress,
-- and saved farms.

-- ---------------------------------------------------------------------------
-- Saved farms (the heart on a farm card)
-- ---------------------------------------------------------------------------
create table public.saved_farms (
  user_id    uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  farm_id    uuid not null references public.farms (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, farm_id)
);
create index saved_farms_farm_idx on public.saved_farms (farm_id);
alter table public.saved_farms enable row level security;
revoke all on public.saved_farms from anon;
revoke update on public.saved_farms from authenticated;
create policy "read own saved farms"   on public.saved_farms for select to authenticated using (user_id = auth.uid());
create policy "save a farm"            on public.saved_farms for insert to authenticated with check (user_id = auth.uid());
create policy "unsave a farm"          on public.saved_farms for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Map query, now with what a farm card needs (replaces the Phase 0 version)
-- ---------------------------------------------------------------------------
drop function if exists public.farms_in_bbox(double precision, double precision, double precision, double precision, text[], smallint, integer);

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
  id            uuid,
  slug          text,
  name          text,
  farmer_name   text,
  categories    text[],
  county_code   smallint,
  county_name   text,
  place_name    text,
  lng           double precision,
  lat           double precision,
  verified      boolean,
  cover_path    text,
  min_price_kes numeric,
  min_price_unit text,
  listing_count integer
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
         (select count(*)::integer from public.listings l where l.farm_id = f.id and l.status = 'active')
  from public.farms f
  join public.counties c on c.code = f.county_code
  left join lateral (
    select l.price_kes, l.unit from public.listings l
    where l.farm_id = f.id and l.status = 'active' and l.price_kes is not null
    order by l.price_kes limit 1
  ) p on true
  where f.status = 'published'
    and f.public_location is not null
    and f.public_location && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
    and (category_filter is null or f.categories && category_filter)
    and (county_filter is null or f.county_code = county_filter)
  order by f.verified_at is not null desc, f.published_at desc
  limit least(greatest(max_rows, 1), 1000);
$$;

-- ---------------------------------------------------------------------------
-- Text search: farm name, farmer, place, products. Also finds farms whose
-- owners hid them from the map (lng/lat come back null for those).
-- ---------------------------------------------------------------------------
create or replace function public.search_farms(
  q               text,
  category_filter text[] default null,
  county_filter   smallint default null,
  max_rows        integer default 50
)
returns table (
  id            uuid,
  slug          text,
  name          text,
  farmer_name   text,
  categories    text[],
  county_code   smallint,
  county_name   text,
  place_name    text,
  lng           double precision,
  lat           double precision,
  verified      boolean,
  cover_path    text,
  min_price_kes numeric,
  min_price_unit text,
  listing_count integer
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
         (select count(*)::integer from public.listings l where l.farm_id = f.id and l.status = 'active')
  from public.farms f
  join public.counties c on c.code = f.county_code
  cross join terms
  left join lateral (
    select l.price_kes, l.unit from public.listings l
    where l.farm_id = f.id and l.status = 'active' and l.price_kes is not null
    order by l.price_kes limit 1
  ) p on true
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

-- ---------------------------------------------------------------------------
-- Farmer dashboard: views and contact taps for a farm you manage
-- ---------------------------------------------------------------------------
create or replace function public.farm_stats(fid uuid)
returns table (views bigint, calls bigint, whatsapps bigint, directions bigint, shares bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.events e where e.name = 'farm.viewed' and e.properties ->> 'farm' = fid::text),
    (select count(*) from public.contact_events ce where ce.farm_id = fid and ce.channel = 'call'),
    (select count(*) from public.contact_events ce where ce.farm_id = fid and ce.channel = 'whatsapp'),
    (select count(*) from public.contact_events ce where ce.farm_id = fid and ce.channel = 'directions'),
    (select count(*) from public.contact_events ce where ce.farm_id = fid and ce.channel = 'share')
  where public.can_manage_farm(fid);
$$;
revoke execute on function public.farm_stats(uuid) from public, anon;
grant execute on function public.farm_stats(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Pilot progress toward the 100-farm target: published farms per pilot
-- county, and how many the signed-in agent enrolled. Counts only.
-- ---------------------------------------------------------------------------
create or replace function public.pilot_progress()
returns table (county_code smallint, county_name text, farms bigint, mine bigint)
language sql
stable
security definer
set search_path = public
as $$
  select c.code, c.name,
         count(f.id) filter (where f.status = 'published'),
         count(f.id) filter (where f.status = 'published' and f.managed_by = auth.uid())
  from public.counties c
  left join public.farms f on f.county_code = c.code
  where c.is_pilot
  group by c.code, c.name
  order by c.name;
$$;
grant execute on function public.pilot_progress() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Pin-your-farm in one transaction: farm + exact location + listings.
-- SECURITY INVOKER, so the same RLS policies decide who may do it. A field
-- agent passing for_farmer = true creates a farm they manage for a farmer
-- without an account.
-- ---------------------------------------------------------------------------
create or replace function public.create_farm(payload jsonb)
returns table (id uuid, slug text)
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  me        uuid := auth.uid();
  is_agent  boolean := coalesce((payload ->> 'for_farmer')::boolean, false);
  new_id    uuid;
  new_slug  text;
  item      jsonb;
  lng       double precision := (payload ->> 'lng')::double precision;
  lat       double precision := (payload ->> 'lat')::double precision;
begin
  if me is null then
    raise exception 'Sign in to pin a farm' using errcode = '42501';
  end if;
  if lng is null or lat is null or lng not between 33.5 and 42 or lat not between -5 and 5.5 then
    raise exception 'The pin must be inside Kenya' using errcode = '22023';
  end if;

  insert into public.farms (owner_id, managed_by, name, farmer_name, description, categories, county_code,
                            sub_county_id, place_name, visibility, size_acres, year_started,
                            phone_public, whatsapp, status)
  values (
    case when is_agent then null else me end,
    case when is_agent then me else null end,
    trim(payload ->> 'name'),
    nullif(trim(payload ->> 'farmer_name'), ''),
    nullif(trim(payload ->> 'description'), ''),
    coalesce(array(select jsonb_array_elements_text(payload -> 'categories')), '{}'),
    (payload ->> 'county_code')::smallint,
    nullif(payload ->> 'sub_county_id', '')::integer,
    nullif(trim(payload ->> 'place_name'), ''),
    coalesce(payload ->> 'visibility', 'approximate')::public.location_visibility,
    nullif(payload ->> 'size_acres', '')::numeric,
    nullif(payload ->> 'year_started', '')::smallint,
    nullif(payload ->> 'phone', ''),
    case when coalesce((payload ->> 'whatsapp_same')::boolean, true) then nullif(payload ->> 'phone', '') else nullif(payload ->> 'whatsapp', '') end,
    'published'
  )
  returning farms.id, farms.slug into new_id, new_slug;

  insert into public.farm_locations (farm_id, location, accuracy_m, source)
  values (new_id, st_setsrid(st_makepoint(lng, lat), 4326)::geography,
          nullif(payload ->> 'accuracy_m', '')::real, case when is_agent then 'agent' else 'pin' end);

  for item in select * from jsonb_array_elements(coalesce(payload -> 'listings', '[]'::jsonb)) loop
    insert into public.listings (farm_id, type, product_slug, title, unit, price_kes, quantity)
    select new_id,
           coalesce(item ->> 'type', case when p.category_slug in ('vet-services') then 'service'
                                          when p.category_slug = 'training' then 'experience'
                                          when p.category_slug in ('dairy','poultry','goats','sheep','pigs','beef','rabbits')
                                               and p.default_unit in ('head','bird','chick') then 'livestock'
                                          when p.category_slug = 'inputs' then 'input'
                                          else 'produce' end)::public.listing_type,
           p.slug, coalesce(nullif(trim(item ->> 'title'), ''), p.name_en), p.default_unit,
           nullif(item ->> 'price_kes', '')::numeric, nullif(item ->> 'quantity', '')::numeric
    from public.products p where p.slug = item ->> 'product_slug';
  end loop;

  return query select new_id, new_slug;
end;
$$;
revoke execute on function public.create_farm(jsonb) from public, anon;
grant execute on function public.create_farm(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Computed columns so the API can return the public pin as plain numbers:
--   select id, name, public_lng, public_lat from farms
-- ---------------------------------------------------------------------------
create or replace function public.public_lng(f public.farms) returns double precision
language sql stable set search_path = public, extensions as $$
  select case when f.public_location is null then null else st_x(f.public_location::geometry) end;
$$;
create or replace function public.public_lat(f public.farms) returns double precision
language sql stable set search_path = public, extensions as $$
  select case when f.public_location is null then null else st_y(f.public_location::geometry) end;
$$;
