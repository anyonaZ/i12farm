-- i12farm · Accounts: user management and farm claiming
-- Admin actions run through SECURITY DEFINER functions that check the admin
-- role first and write to auth.audit_log, so role changes never need raw SQL
-- and every change is on record. Farmers enrolled by a field agent take
-- ownership with a one-time claim code the agent reads out to them (no SMS cost).

-- ---------------------------------------------------------------------------
-- Admin: list, role changes, suspension, farm verification
-- ---------------------------------------------------------------------------
create or replace function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Admins only' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.admin_list_users(q text default null, max_rows integer default 50)
returns table (
  id              uuid,
  full_name       text,
  email           text,
  phone           text,
  roles           public.user_role[],
  status          text,
  county_code     smallint,
  created_at      timestamptz,
  last_sign_in_at timestamptz,
  farms           integer,
  has_password    boolean,
  has_google      boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return query
    select u.id, p.full_name, u.email, u.phone, p.roles, u.status, p.county_code, u.created_at, u.last_sign_in_at,
           (select count(*)::integer from public.farms f where f.owner_id = u.id or f.managed_by = u.id),
           u.password_hash is not null,
           exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'google')
    from auth.users u
    join public.profiles p on p.id = u.id
    where coalesce(trim(q), '') = ''
       or position(lower(trim(q)) in lower(concat_ws(' ', p.full_name, u.email, u.phone, p.phone))) > 0
    order by u.created_at desc
    limit least(greatest(max_rows, 1), 200);
end;
$$;

create or replace function public.admin_set_roles(target uuid, new_roles public.user_role[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  before public.user_role[];
begin
  perform public.require_admin();
  if target = auth.uid() and not ('admin' = any (new_roles)) then
    raise exception 'You cannot remove your own admin role' using errcode = '42501';
  end if;
  select roles into before from public.profiles where id = target for update;
  if not found then
    raise exception 'No such user' using errcode = 'P0002';
  end if;
  update public.profiles
     set roles = (select coalesce(array_agg(distinct r order by r), '{}') from unnest(new_roles) r)
   where id = target;
  insert into auth.audit_log (actor_id, target_id, action, details)
  values (auth.uid(), target, 'roles.changed', jsonb_build_object('from', before, 'to', new_roles));
end;
$$;

create or replace function public.admin_set_user_status(target uuid, new_status text, reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  if new_status not in ('active', 'suspended') then
    raise exception 'Unknown status %', new_status using errcode = '22023';
  end if;
  if target = auth.uid() then
    raise exception 'You cannot suspend yourself' using errcode = '42501';
  end if;
  update auth.users set status = new_status where id = target;
  if not found then
    raise exception 'No such user' using errcode = 'P0002';
  end if;
  if new_status = 'suspended' then
    update auth.sessions set revoked_at = now(), revoked_reason = 'suspended'
     where user_id = target and revoked_at is null;
  end if;
  insert into auth.audit_log (actor_id, target_id, action, details)
  values (auth.uid(), target, 'status.' || new_status, jsonb_build_object('reason', reason));
end;
$$;

create or replace function public.admin_verify_farm(fid uuid, verified boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  update public.farms
     set verified_at = case when verified then coalesce(verified_at, now()) end,
         verified_by = case when verified then auth.uid() end
   where id = fid;
  if not found then
    raise exception 'No such farm' using errcode = 'P0002';
  end if;
  insert into auth.audit_log (actor_id, action, details)
  values (auth.uid(), case when verified then 'farm.verified' else 'farm.unverified' end, jsonb_build_object('farm', fid));
end;
$$;

-- Farms waiting for a field check, newest first (admin screen).
create or replace function public.admin_list_farms(only_unverified boolean default true, max_rows integer default 50)
returns table (id uuid, slug text, name text, farmer_name text, county_name text, place_name text,
               verified boolean, published_at timestamptz, managed_by_name text, owner_claimed boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return query
    select f.id, f.slug, f.name, f.farmer_name, c.name, f.place_name, f.verified_at is not null, f.published_at,
           (select p.full_name from public.profiles p where p.id = f.managed_by), f.owner_id is not null
    from public.farms f
    join public.counties c on c.code = f.county_code
    where f.status = 'published' and (not only_unverified or f.verified_at is null)
    order by f.published_at desc nulls last
    limit least(greatest(max_rows, 1), 200);
end;
$$;

revoke execute on function public.require_admin() from public, anon;
revoke execute on function public.admin_list_users(text, integer) from public, anon;
revoke execute on function public.admin_set_roles(uuid, public.user_role[]) from public, anon;
revoke execute on function public.admin_set_user_status(uuid, text, text) from public, anon;
revoke execute on function public.admin_verify_farm(uuid, boolean) from public, anon;
revoke execute on function public.admin_list_farms(boolean, integer) from public, anon;
grant execute on function public.admin_list_users(text, integer), public.admin_set_roles(uuid, public.user_role[]),
  public.admin_set_user_status(uuid, text, text), public.admin_verify_farm(uuid, boolean),
  public.admin_list_farms(boolean, integer), public.require_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Farm claim codes
-- The managing agent issues an 8-digit code; the farmer signs up (phone +
-- password) and enters it to become the farm's owner. Codes are stored as
-- SHA-256 only, expire after 14 days, work once, and a user gets 10 wrong
-- tries a day.
-- ---------------------------------------------------------------------------
create table public.farm_claim_codes (
  id          uuid primary key default gen_random_uuid(),
  farm_id     uuid not null references public.farms (id) on delete cascade,
  code_hash   bytea not null unique,
  issued_by   uuid references public.profiles (id) on delete set null,
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  claimed_by  uuid references public.profiles (id) on delete set null,
  claimed_at  timestamptz,
  revoked_at  timestamptz
);
create index farm_claim_codes_farm_idx on public.farm_claim_codes (farm_id);

create table public.farm_claim_attempts (
  id       bigint generated always as identity primary key,
  user_id  uuid references public.profiles (id) on delete set null,
  farm_id  uuid references public.farms (id) on delete set null,
  success  boolean not null,
  at       timestamptz not null default now()
);
create index farm_claim_attempts_user_idx on public.farm_claim_attempts (user_id, at);

alter table public.farm_claim_codes enable row level security;
alter table public.farm_claim_attempts enable row level security;
revoke all on public.farm_claim_codes, public.farm_claim_attempts from anon, authenticated;

create or replace function public.issue_claim_code(fid uuid)
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_code text;
  until    timestamptz := now() + interval '14 days';
begin
  if not public.can_manage_farm(fid) then
    raise exception 'You do not manage this farm' using errcode = '42501';
  end if;
  if exists (select 1 from public.farms f where f.id = fid and f.owner_id is not null) then
    raise exception 'This farm already has an owner' using errcode = '23505';
  end if;

  -- 8 digits from gen_random_uuid() (pg_strong_random under the hood).
  new_code := lpad((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15))::bit(60)::bigint % 100000000)::text, 8, '0');

  update public.farm_claim_codes c set revoked_at = now()
   where c.farm_id = fid and c.claimed_at is null and c.revoked_at is null;
  insert into public.farm_claim_codes (farm_id, code_hash, issued_by, expires_at)
  values (fid, sha256(convert_to(new_code, 'UTF8')), auth.uid(), until);

  return query select new_code, until;
end;
$$;

create or replace function public.claim_farm(code text)
returns table (id uuid, slug text, name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  me     uuid := auth.uid();
  digits text := regexp_replace(coalesce(code, ''), '\D', '', 'g');
  hit    public.farm_claim_codes;
begin
  if me is null then
    raise exception 'Sign in to claim a farm' using errcode = '42501';
  end if;
  if (select count(*) from public.farm_claim_attempts a
       where a.user_id = me and not a.success and a.at > now() - interval '1 day') >= 10 then
    raise exception 'Too many wrong codes today. Try again tomorrow.' using errcode = '54000';
  end if;

  select * into hit from public.farm_claim_codes c
   where c.code_hash = sha256(convert_to(digits, 'UTF8'))
     and c.claimed_at is null and c.revoked_at is null and c.expires_at > now()
   for update;

  if not found or exists (select 1 from public.farms f where f.id = hit.farm_id and f.owner_id is not null) then
    insert into public.farm_claim_attempts (user_id, farm_id, success) values (me, null, false);
    return;   -- no rows: wrong, used or expired code
  end if;

  update public.farms f set owner_id = me where f.id = hit.farm_id;
  update public.farm_claim_codes c set claimed_by = me, claimed_at = now() where c.id = hit.id;
  update public.profiles p
     set roles = (select array_agg(distinct r) from unnest(p.roles || array['farmer']::public.user_role[]) r)
   where p.id = me;
  insert into public.farm_claim_attempts (user_id, farm_id, success) values (me, hit.farm_id, true);

  return query select f.id, f.slug, f.name from public.farms f where f.id = hit.farm_id;
end;
$$;

revoke execute on function public.issue_claim_code(uuid) from public, anon;
revoke execute on function public.claim_farm(text) from public, anon;
grant execute on function public.issue_claim_code(uuid), public.claim_farm(text) to authenticated;
