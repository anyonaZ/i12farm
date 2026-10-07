-- i12farm · Phase 0 · Foundation
-- Extensions, shared helpers and reference data tables (counties, sub-counties,
-- wards, farm categories, products). Reference data uses official codes so our
-- data joins cleanly with KNBS / IEBC / Ministry of Agriculture statistics.

create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Administrative units (Kenya first; country column keeps the door open)
-- ---------------------------------------------------------------------------
create table public.counties (
  code        smallint primary key check (code between 1 and 99),
  country     char(2)  not null default 'KE',
  name        text     not null unique,
  -- Map focus point (county HQ town). Approximate; replaced by a computed
  -- centroid once official boundaries are loaded.
  focus_point extensions.geography(Point, 4326),
  created_at  timestamptz not null default now()
);
comment on table public.counties is 'Official county codes 001–047 (Constitution of Kenya 2010, First Schedule).';

create table public.sub_counties (
  id          serial   primary key,
  county_code smallint not null references public.counties (code),
  name        text     not null,
  unique (county_code, name)
);
comment on table public.sub_counties is 'Constituency-level units (IEBC). Loaded by scripts/import-admin-units.ts.';

create table public.wards (
  id             serial   primary key,
  iebc_code      text     unique,
  sub_county_id  integer  not null references public.sub_counties (id),
  county_code    smallint not null references public.counties (code),
  name           text     not null,
  unique (sub_county_id, name)
);
comment on table public.wards is 'County assembly wards (IEBC codes). Loaded by scripts/import-admin-units.ts.';

-- ---------------------------------------------------------------------------
-- Controlled vocabularies: one fixed list so analysis never fights spelling
-- ---------------------------------------------------------------------------
create table public.farm_categories (
  slug       text primary key check (slug ~ '^[a-z0-9-]{2,40}$'),
  name_en    text not null,
  name_sw    text not null,
  icon       text not null,           -- icon key used by the map pin renderer
  sort_order smallint not null default 100,
  active     boolean not null default true
);

create table public.products (
  slug          text primary key check (slug ~ '^[a-z0-9-]{2,60}$'),
  category_slug text not null references public.farm_categories (slug),
  name_en       text not null,
  name_sw       text not null,
  default_unit  text not null,        -- e.g. litre, kg, tray, bird, head, bag-90kg
  active        boolean not null default true
);
create index products_category_idx on public.products (category_slug);
