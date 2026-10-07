-- i12farm · Phase 0 · Event log and daily rollups
-- Every meaningful action is appended here with a timestamp and county code.
-- Raw rows (~200 bytes each) are rolled into events_daily every night; when the
-- database nears its quota, raw rows older than 90 days are exported to
-- Parquet and removed (see scripts/export-events.ts in a later phase).

create table public.events (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),   -- client clock, clamped server-side
  received_at  timestamptz not null default now(),   -- server clock, trusted
  user_id      uuid references auth.users (id) on delete set null,
  anonymous_id text check (char_length(anonymous_id) <= 64),
  session_id   text check (char_length(session_id) <= 64),
  name         text not null check (name ~ '^[a-z][a-z0-9_.]{1,63}$'),
  properties   jsonb not null default '{}'::jsonb check (pg_column_size(properties) <= 2048),
  county_code  smallint references public.counties (code),
  path         text check (char_length(path) <= 300),
  device       text check (char_length(device) <= 40),
  locale       text check (locale in ('en', 'sw')),
  app_version  text check (char_length(app_version) <= 20),
  constraint events_has_actor check (user_id is not null or anonymous_id is not null)
);

create index events_name_time_idx on public.events (name, occurred_at);
create index events_user_idx      on public.events (user_id, occurred_at) where user_id is not null;
create index events_received_brin on public.events using brin (received_at);

-- Server-side guard: a client can't log events as someone else, and can't
-- backdate or future-date beyond a day.
create or replace function public.events_before_insert()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is not null and new.user_id is distinct from auth.uid() then
    raise exception 'user_id must match the signed-in user' using errcode = '42501';
  end if;
  new.received_at := now();
  if new.occurred_at is null or new.occurred_at > now() + interval '5 minutes'
     or new.occurred_at < now() - interval '1 day' then
    new.occurred_at := now();
  end if;
  return new;
end;
$$;

create trigger events_before_insert
  before insert on public.events
  for each row execute function public.events_before_insert();

-- ---------------------------------------------------------------------------
-- Daily rollup: small, permanent, and what dashboards read.
-- ---------------------------------------------------------------------------
create table public.events_daily (
  day          date     not null,
  name         text     not null,
  county_code  smallint not null default 0,      -- 0 = unknown county
  events       integer  not null,
  actors       integer  not null,                -- distinct user or anonymous ids
  primary key (day, name, county_code)
);

create or replace function public.rollup_events(target_day date default (now() at time zone 'Africa/Nairobi')::date - 1)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.events_daily where day = target_day;

  insert into public.events_daily (day, name, county_code, events, actors)
  select target_day, e.name, coalesce(e.county_code, 0),
         count(*), count(distinct coalesce(e.user_id::text, e.anonymous_id))
  from public.events e
  where e.occurred_at >= (target_day::timestamp at time zone 'Africa/Nairobi')
    and e.occurred_at <  ((target_day + 1)::timestamp at time zone 'Africa/Nairobi')
  group by e.name, coalesce(e.county_code, 0);

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.rollup_events(date) from public, anon, authenticated;

-- Schedule the nightly rollup at 00:30 Nairobi (21:30 UTC) where pg_cron exists
-- (it does on Supabase; enable it under Database → Extensions first).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('i12farm-rollup-events', '30 21 * * *', 'select public.rollup_events()');
  else
    raise notice 'pg_cron not enabled: schedule public.rollup_events() nightly once it is.';
  end if;
end;
$$;
