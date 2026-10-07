-- i12farm · Phase 0 · Farms, media, listings, price history, contact events
-- Schema for everything Phase 1 ships. Exact farm coordinates live in their own
-- table that only the farm's managers can read; the map only ever sees
-- farms.public_location, which is exact, snapped to ~1 km, or empty, per the
-- farmer's choice.

create type public.location_visibility as enum ('exact', 'approximate', 'hidden');
create type public.farm_status        as enum ('draft', 'published', 'suspended');
create type public.listing_type       as enum ('produce', 'livestock', 'input', 'service', 'experience');
create type public.listing_status     as enum ('active', 'paused', 'sold_out', 'archived');
create type public.contact_channel    as enum ('call', 'whatsapp', 'sms', 'directions', 'share');

-- ---------------------------------------------------------------------------
-- farms
-- ---------------------------------------------------------------------------
create table public.farms (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  -- The farmer's own account. Null while a field agent manages a farmer who
  -- has no account yet; the farmer claims it later with phone sign-in.
  owner_id        uuid references public.profiles (id) on delete set null,
  managed_by      uuid references public.profiles (id) on delete set null,
  created_by      uuid references public.profiles (id) default auth.uid(),
  name            text not null check (char_length(name) between 2 and 80),
  farmer_name     text check (char_length(farmer_name) <= 120),
  description     text check (char_length(description) <= 2000),
  categories      text[] not null default '{}',
  county_code     smallint not null references public.counties (code),
  sub_county_id   integer references public.sub_counties (id),
  ward_id         integer references public.wards (id),
  place_name      text check (char_length(place_name) <= 120),   -- village or landmark, e.g. "Imbo"
  visibility      public.location_visibility not null default 'approximate',
  public_location extensions.geography(Point, 4326),              -- maintained by trigger, never written directly
  size_acres      numeric(10, 2) check (size_acres is null or size_acres > 0),
  year_started    smallint check (year_started is null or year_started between 1900 and 2100),
  phone_public    text check (phone_public is null or phone_public ~ '^\+?[0-9]{9,15}$'),
  whatsapp        text check (whatsapp is null or whatsapp ~ '^\+?[0-9]{9,15}$'),
  status          public.farm_status not null default 'draft',
  verified_at     timestamptz,
  verified_by     uuid references public.profiles (id),
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint farms_has_manager check (owner_id is not null or managed_by is not null)
);

create index farms_public_location_gix on public.farms using gist (public_location);
create index farms_categories_gin     on public.farms using gin (categories);
create index farms_county_status_idx  on public.farms (county_code, status);
create index farms_name_trgm          on public.farms using gin (name extensions.gin_trgm_ops);
create index farms_owner_idx          on public.farms (owner_id);
create index farms_managed_by_idx     on public.farms (managed_by);

create trigger farms_updated_at
  before update on public.farms
  for each row execute function public.set_updated_at();

-- Who may edit a farm: its owner, the agent managing it, or an admin.
create or replace function public.can_manage_farm(fid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    exists (
      select 1 from public.farms f
      where f.id = fid and (f.owner_id = auth.uid() or f.managed_by = auth.uid())
    )
    or public.has_role('admin')
  );
$$;

-- Slug, category validation, publish timestamp. public_location is derived:
-- client writes are ignored unless the location sync below is running.
create or replace function public.farms_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  bad text;
  syncing boolean := coalesce(current_setting('i12farm.syncing_location', true), 'off') = 'on';
begin
  if tg_op = 'INSERT' and (new.slug is null or new.slug = '') then
    new.slug := trim(both '-' from regexp_replace(lower(new.name), '[^a-z0-9]+', '-', 'g'))
                || '-' || substr(md5(gen_random_uuid()::text), 1, 5);
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

create trigger farms_before_write
  before insert or update on public.farms
  for each row execute function public.farms_before_write();

-- ---------------------------------------------------------------------------
-- farm_locations: exact coordinates, private to the farm's managers
-- ---------------------------------------------------------------------------
create table public.farm_locations (
  farm_id     uuid primary key references public.farms (id) on delete cascade,
  location    extensions.geography(Point, 4326) not null,
  accuracy_m  real check (accuracy_m is null or accuracy_m >= 0),
  source      text not null default 'pin' check (source in ('gps', 'pin', 'agent', 'import')),
  updated_at  timestamptz not null default now()
);

create trigger farm_locations_updated_at
  before update on public.farm_locations
  for each row execute function public.set_updated_at();

-- Recompute the public pin from the exact point and the visibility choice.
-- Approximate = snapped to the centre of a 0.01° cell (~1.1 km), so the
-- farm is findable but the homestead is not pinpointed.
create or replace function public.sync_public_location(fid uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.farms f
  set public_location = case f.visibility
        when 'exact'       then fl.location
        when 'approximate' then st_snaptogrid(fl.location::geometry, 0.005, 0.005, 0.01, 0.01)::geography
        else null
      end
  from public.farm_locations fl
  where f.id = fid and fl.farm_id = f.id;

  -- No exact point on file → no public pin.
  update public.farms f
  set public_location = null
  where f.id = fid
    and not exists (select 1 from public.farm_locations fl where fl.farm_id = fid);
end;
$$;

-- The sync sets a transaction-local flag so farms_before_write lets it
-- write public_location.
create or replace function public.farm_locations_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('i12farm.syncing_location', 'on', true);
  perform public.sync_public_location(coalesce(new.farm_id, old.farm_id));
  perform set_config('i12farm.syncing_location', 'off', true);
  return null;
end;
$$;

create trigger farm_locations_after_write
  after insert or update or delete on public.farm_locations
  for each row execute function public.farm_locations_after_write();

create or replace function public.farms_after_visibility_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.visibility is distinct from old.visibility then
    perform set_config('i12farm.syncing_location', 'on', true);
    perform public.sync_public_location(new.id);
    perform set_config('i12farm.syncing_location', 'off', true);
  end if;
  return null;
end;
$$;

create trigger farms_after_visibility_change
  after update of visibility on public.farms
  for each row execute function public.farms_after_visibility_change();


-- ---------------------------------------------------------------------------
-- farm_media: photos in Storage bucket "farm-media", path farms/<farm_id>/<file>
-- ---------------------------------------------------------------------------
create table public.farm_media (
  id           uuid primary key default gen_random_uuid(),
  farm_id      uuid not null references public.farms (id) on delete cascade,
  storage_path text not null unique,
  kind         text not null default 'photo' check (kind in ('photo', 'video')),
  position     smallint not null default 0,
  width        integer,
  height       integer,
  bytes        integer check (bytes is null or bytes <= 2000000),
  created_at   timestamptz not null default now()
);
create index farm_media_farm_idx on public.farm_media (farm_id, position);

-- ---------------------------------------------------------------------------
-- listings: what a farm offers (produce, livestock, inputs, services, experiences)
-- ---------------------------------------------------------------------------
create table public.listings (
  id             uuid primary key default gen_random_uuid(),
  farm_id        uuid not null references public.farms (id) on delete cascade,
  type           public.listing_type not null,
  product_slug   text references public.products (slug),
  title          text not null check (char_length(title) between 2 and 100),
  description    text check (char_length(description) <= 1000),
  unit           text not null check (char_length(unit) between 1 and 30),
  price_kes      numeric(12, 2) check (price_kes is null or price_kes >= 0),   -- null = price on request
  quantity       numeric(12, 2) check (quantity is null or quantity >= 0),
  available_from date,
  available_to   date,
  status         public.listing_status not null default 'active',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint listings_dates check (available_to is null or available_from is null or available_to >= available_from)
);
create index listings_farm_idx    on public.listings (farm_id, status);
create index listings_product_idx on public.listings (product_slug, status);

create trigger listings_updated_at
  before update on public.listings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- price_history: append-only, one row per price/quantity/status change.
-- Source of the county price index in Phase 4.
-- ---------------------------------------------------------------------------
create table public.price_history (
  id           bigint generated always as identity primary key,
  listing_id   uuid not null references public.listings (id) on delete cascade,
  farm_id      uuid not null references public.farms (id) on delete cascade,
  product_slug text references public.products (slug),
  county_code  smallint not null references public.counties (code),
  unit         text not null,
  price_kes    numeric(12, 2),
  quantity     numeric(12, 2),
  status       public.listing_status not null,
  observed_at  timestamptz not null default now()
);
create index price_history_product_time_idx on public.price_history (product_slug, county_code, observed_at);

create or replace function public.listings_record_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     or new.price_kes is distinct from old.price_kes
     or new.quantity  is distinct from old.quantity
     or new.unit      is distinct from old.unit
     or new.status    is distinct from old.status then
    insert into public.price_history (listing_id, farm_id, product_slug, county_code, unit, price_kes, quantity, status)
    select new.id, new.farm_id, new.product_slug, f.county_code, new.unit, new.price_kes, new.quantity, new.status
    from public.farms f where f.id = new.farm_id;
  end if;
  return null;
end;
$$;

create trigger listings_record_price
  after insert or update on public.listings
  for each row execute function public.listings_record_price();

-- ---------------------------------------------------------------------------
-- contact_events: a buyer tapped Call / WhatsApp / Directions.
-- Phase 1's proof of demand before checkout exists.
-- ---------------------------------------------------------------------------
create table public.contact_events (
  id           bigint generated always as identity primary key,
  farm_id      uuid not null references public.farms (id) on delete cascade,
  listing_id   uuid references public.listings (id) on delete set null,
  actor_id     uuid references public.profiles (id) on delete set null default auth.uid(),
  anonymous_id text check (char_length(anonymous_id) <= 64),
  channel      public.contact_channel not null,
  county_code  smallint references public.counties (code),   -- farm's county, filled by trigger
  created_at   timestamptz not null default now()
);
create index contact_events_farm_time_idx on public.contact_events (farm_id, created_at);

create or replace function public.contact_events_fill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select f.county_code into new.county_code from public.farms f where f.id = new.farm_id;
  new.created_at := now();
  return new;
end;
$$;

create trigger contact_events_fill
  before insert on public.contact_events
  for each row execute function public.contact_events_fill();

-- ---------------------------------------------------------------------------
-- Map query used by the Explore screen. SECURITY INVOKER: RLS decides which
-- farms come back, so drafts and hidden pins never leak.
-- ---------------------------------------------------------------------------
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
  id           uuid,
  slug         text,
  name         text,
  categories   text[],
  county_code  smallint,
  place_name   text,
  lng          double precision,
  lat          double precision,
  verified     boolean,
  cover_path   text
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select f.id, f.slug, f.name, f.categories, f.county_code, f.place_name,
         st_x(f.public_location::geometry), st_y(f.public_location::geometry),
         f.verified_at is not null,
         (select m.storage_path from public.farm_media m
           where m.farm_id = f.id and m.kind = 'photo'
           order by m.position, m.created_at limit 1)
  from public.farms f
  where f.status = 'published'
    and f.public_location is not null
    and f.public_location && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
    and (category_filter is null or f.categories && category_filter)
    and (county_filter is null or f.county_code = county_filter)
  order by f.verified_at is not null desc, f.published_at desc
  limit least(greatest(max_rows, 1), 1000);
$$;
