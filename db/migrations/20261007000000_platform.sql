-- i12farm · Platform
-- Our own replacement for what Supabase used to provide: database roles that
-- row-level security is written against, and an `auth` schema with users,
-- sessions and sign-in records. No vendor service sits in front of Postgres;
-- the Next.js server is the only client.
--
-- How a request reaches the data (src/lib/db):
--   1. The server connects as the database owner.
--   2. For every user-facing query it opens a transaction and runs
--        select set_config('role', 'authenticated' | 'anon', true),
--               set_config('app.user_id', '<uuid>' | '', true);
--   3. Row-level security and column grants then apply exactly as before,
--      and auth.uid() returns the signed-in user for that transaction only.
-- Auth bookkeeping (users, sessions) runs as the owner and is never exposed
-- to the anon/authenticated roles.

-- ---------------------------------------------------------------------------
-- Roles RLS policies are written for
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end;
$$;

-- The connecting role must be able to SET ROLE into both. A superuser can
-- already; a managed-database owner (Neon, Aiven, a VPS user) needs the grant.
do $$
begin
  execute format('grant anon, authenticated to %I', current_user);
exception when others then
  raise notice 'Could not grant anon/authenticated to %: % (fine for a superuser)', current_user, sqlerrm;
end;
$$;

create schema if not exists extensions;
create schema if not exists auth;

grant usage on schema public, extensions to anon, authenticated;
grant usage on schema auth to anon, authenticated;   -- for auth.uid() only; no table grants

-- Same default as before: table privileges are granted broadly and each
-- migration revokes what a role must not do; RLS decides which rows.
alter default privileges in schema public grant all on tables    to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;

-- Shared trigger (also used by later migrations): keep updated_at honest.
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
-- auth.uid(): the signed-in user for the current transaction
-- ---------------------------------------------------------------------------
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid;
$$;
grant execute on function auth.uid() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Users. A person signs in with a Kenyan phone number or an email address
-- (or both), plus a password; Google sign-in links through auth.identities.
-- ---------------------------------------------------------------------------
create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text check (email is null or (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  email_verified_at  timestamptz,
  phone              text check (phone is null or phone ~ '^254[17][0-9]{8}$'),   -- 2547XXXXXXXX / 2541XXXXXXXX
  phone_verified_at  timestamptz,
  password_hash      text,                                                       -- scrypt$N$r$p$salt$hash, null for Google-only
  password_changed_at timestamptz,
  meta               jsonb not null default '{}'::jsonb,                           -- full_name, locale at sign-up
  status             text not null default 'active' check (status in ('active', 'suspended')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_sign_in_at    timestamptz,
  constraint users_has_identifier check (email is not null or phone is not null)
);
create unique index users_email_key on auth.users (email) where email is not null;
create unique index users_phone_key on auth.users (phone) where phone is not null;

create trigger users_updated_at
  before update on auth.users
  for each row execute function public.set_updated_at();

-- External sign-in providers (Google today).
create table auth.identities (
  provider          text not null check (provider in ('google')),
  provider_user_id  text not null,
  user_id           uuid not null references auth.users (id) on delete cascade,
  email             text,
  created_at        timestamptz not null default now(),
  last_used_at      timestamptz not null default now(),
  primary key (provider, provider_user_id)
);
create index identities_user_idx on auth.identities (user_id);

-- Sessions: the browser holds a random 32-byte token in an httpOnly cookie;
-- only its SHA-256 is stored, so a database leak does not leak sessions.
-- Signing out sets revoked_at; rows are kept as a record of access.
create table auth.sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  token_hash     bytea not null unique,
  method         text not null check (method in ('password', 'google', 'email_link', 'admin_link', 'sign_up')),
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  revoked_reason text,
  user_agent     text check (char_length(user_agent) <= 300),
  ip             inet
);
create index sessions_user_idx on auth.sessions (user_id) where revoked_at is null;

-- One-time sign-in links (emailed, or issued by an admin for a farmer who
-- forgot their password). Only the hash is stored; a link works once.
create table auth.one_time_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  purpose     text not null check (purpose in ('email_link', 'admin_link')),
  token_hash  bytea not null unique,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index one_time_tokens_user_idx on auth.one_time_tokens (user_id, created_at);

-- Every sign-in attempt, successful or not. Used to slow down password
-- guessing and kept for later analysis. Append-only.
create table auth.sign_in_attempts (
  id          bigint generated always as identity primary key,
  identifier  text not null,           -- normalised phone or email, or 'google:<sub>'
  method      text not null,
  success     boolean not null,
  reason      text,
  user_id     uuid references auth.users (id) on delete set null,
  ip          inet,
  at          timestamptz not null default now()
);
create index sign_in_attempts_identifier_idx on auth.sign_in_attempts (identifier, at);
create index sign_in_attempts_ip_idx on auth.sign_in_attempts (ip, at);

-- Who changed what about which account (roles, suspension, sign-in links).
create table auth.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references auth.users (id) on delete set null,
  target_id   uuid references auth.users (id) on delete set null,
  action      text not null,
  details     jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now()
);
create index audit_log_target_idx on auth.audit_log (target_id, at);

-- Nothing in auth is readable by the request roles.
revoke all on all tables in schema auth from anon, authenticated, public;
revoke all on all sequences in schema auth from anon, authenticated, public;
