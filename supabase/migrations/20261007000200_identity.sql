-- i12farm · Phase 0 · Identity
-- One profile per auth user. Roles are an array so one person can be a
-- farmer and a buyer at once. Users cannot grant themselves roles: only the
-- listed self-service columns are updatable by the authenticated role.

create type public.user_role as enum ('farmer', 'buyer', 'provider', 'agent', 'partner', 'admin');

create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  full_name          text check (char_length(full_name) <= 120),
  phone              text check (phone is null or phone ~ '^\+?[0-9]{9,15}$'),
  roles              public.user_role[] not null default array['buyer']::public.user_role[],
  county_code        smallint references public.counties (code),
  sub_county_id      integer  references public.sub_counties (id),
  ward_id            integer  references public.wards (id),
  preferred_language text not null default 'en' check (preferred_language in ('en', 'sw')),
  joined_via         text not null default 'self' check (joined_via in ('self', 'agent', 'ussd', 'import')),
  onboarded_by       uuid references public.profiles (id),
  consent_version    text,
  consent_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index profiles_county_idx on public.profiles (county_code);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create a profile automatically for every new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, preferred_language)
  values (
    new.id,
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), ''),
    case when new.raw_user_meta_data ->> 'locale' = 'sw' then 'sw' else 'en' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role check used by RLS policies. SECURITY DEFINER so policies on other
-- tables can read roles without exposing the profiles table.
create or replace function public.has_role(r public.user_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and r = any (p.roles)
  );
$$;

-- Column-level privileges: roles, joined_via, onboarded_by are admin-only.
revoke insert, update, delete on public.profiles from anon, authenticated;
revoke select on public.profiles from anon;
grant update (full_name, phone, county_code, sub_county_id, ward_id,
              preferred_language, consent_version, consent_at)
  on public.profiles to authenticated;
