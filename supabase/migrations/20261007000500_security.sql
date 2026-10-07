-- i12farm · Phase 0 · Row-level security
-- Security lives in the database: even if an API route has a bug, a farmer can
-- only change their own farm, exact coordinates stay private, and nobody but
-- admins can read the raw event log.

alter table public.counties        enable row level security;
alter table public.sub_counties    enable row level security;
alter table public.wards           enable row level security;
alter table public.farm_categories enable row level security;
alter table public.products        enable row level security;
alter table public.profiles        enable row level security;
alter table public.farms           enable row level security;
alter table public.farm_locations  enable row level security;
alter table public.farm_media      enable row level security;
alter table public.listings        enable row level security;
alter table public.price_history   enable row level security;
alter table public.contact_events  enable row level security;
alter table public.events          enable row level security;
alter table public.events_daily    enable row level security;

-- ---------------------------------------------------------------------------
-- Reference data: readable by everyone, writable only via migrations/admin
-- ---------------------------------------------------------------------------
revoke insert, update, delete on public.counties, public.sub_counties, public.wards,
  public.farm_categories, public.products from anon, authenticated;

create policy "reference readable" on public.counties        for select using (true);
create policy "reference readable" on public.sub_counties    for select using (true);
create policy "reference readable" on public.wards           for select using (true);
create policy "reference readable" on public.farm_categories for select using (true);
create policy "reference readable" on public.products        for select using (true);

-- ---------------------------------------------------------------------------
-- profiles (column grants in the identity migration limit what can change)
-- ---------------------------------------------------------------------------
create policy "read own profile" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.has_role('admin'));

create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- farms
-- ---------------------------------------------------------------------------
create policy "published farms are public" on public.farms
  for select
  using (status = 'published' or public.can_manage_farm(id));

-- A farmer creates their own farm; a field agent creates one they manage.
create policy "create own or agent-managed farm" on public.farms
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and (
      (owner_id = auth.uid() and (managed_by is null or managed_by = auth.uid()))
      or (owner_id is null and managed_by = auth.uid() and public.has_role('agent'))
      or public.has_role('admin')
    )
  );

create policy "managers update farm" on public.farms
  for update to authenticated
  using (public.can_manage_farm(id))
  with check (public.can_manage_farm(id));

create policy "owner or admin deletes farm" on public.farms
  for delete to authenticated
  using (owner_id = auth.uid() or public.has_role('admin'));

-- Only admins verify or suspend; enforce at column level.
revoke update on public.farms from anon, authenticated;
grant update (name, farmer_name, description, categories, county_code, sub_county_id, ward_id,
              place_name, visibility, size_acres, year_started, phone_public, whatsapp, status)
  on public.farms to authenticated;

create or replace function public.farms_guard_status()
returns trigger
language plpgsql
as $$
begin
  if (new.status = 'suspended' or old.status = 'suspended') and new.status is distinct from old.status
     and not public.has_role('admin') then
    raise exception 'Only admins can suspend or restore a farm' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger farms_guard_status
  before update of status on public.farms
  for each row execute function public.farms_guard_status();

-- ---------------------------------------------------------------------------
-- farm_locations: exact point, managers only. Never readable by the public.
-- ---------------------------------------------------------------------------
revoke all on public.farm_locations from anon;

create policy "managers read exact location" on public.farm_locations
  for select to authenticated using (public.can_manage_farm(farm_id));
create policy "managers set exact location" on public.farm_locations
  for insert to authenticated with check (public.can_manage_farm(farm_id));
create policy "managers move exact location" on public.farm_locations
  for update to authenticated using (public.can_manage_farm(farm_id)) with check (public.can_manage_farm(farm_id));
create policy "managers clear exact location" on public.farm_locations
  for delete to authenticated using (public.can_manage_farm(farm_id));

-- ---------------------------------------------------------------------------
-- farm_media and listings: visible when their farm is visible
-- ---------------------------------------------------------------------------
create policy "media of visible farms" on public.farm_media
  for select using (exists (select 1 from public.farms f where f.id = farm_id));
create policy "managers add media" on public.farm_media
  for insert to authenticated with check (public.can_manage_farm(farm_id));
create policy "managers edit media" on public.farm_media
  for update to authenticated using (public.can_manage_farm(farm_id)) with check (public.can_manage_farm(farm_id));
create policy "managers remove media" on public.farm_media
  for delete to authenticated using (public.can_manage_farm(farm_id));

create policy "active listings of visible farms" on public.listings
  for select using (
    (status in ('active', 'sold_out') and exists (select 1 from public.farms f where f.id = farm_id and f.status = 'published'))
    or public.can_manage_farm(farm_id)
  );
create policy "managers add listings" on public.listings
  for insert to authenticated with check (public.can_manage_farm(farm_id));
create policy "managers edit listings" on public.listings
  for update to authenticated using (public.can_manage_farm(farm_id)) with check (public.can_manage_farm(farm_id));
create policy "managers remove listings" on public.listings
  for delete to authenticated using (public.can_manage_farm(farm_id));

-- ---------------------------------------------------------------------------
-- Append-only history and logs
-- ---------------------------------------------------------------------------
revoke insert, update, delete on public.price_history from anon, authenticated;
create policy "managers and admins read price history" on public.price_history
  for select to authenticated using (public.can_manage_farm(farm_id));

revoke update, delete on public.contact_events from anon, authenticated;
revoke select on public.contact_events from anon;
create policy "anyone logs a contact on a published farm" on public.contact_events
  for insert to anon, authenticated
  with check (
    (actor_id is null or actor_id = auth.uid())
    and exists (select 1 from public.farms f where f.id = farm_id and f.status = 'published')
  );
create policy "farm managers see their contacts" on public.contact_events
  for select to authenticated using (public.can_manage_farm(farm_id));

revoke update, delete on public.events from anon, authenticated;
revoke select on public.events from anon;
create policy "anyone logs events as themselves" on public.events
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());
create policy "admins read events" on public.events
  for select to authenticated using (public.has_role('admin'));

revoke all on public.events_daily from anon;
revoke insert, update, delete on public.events_daily from authenticated;
create policy "admins and partners read rollups" on public.events_daily
  for select to authenticated using (public.has_role('admin') or public.has_role('partner'));

-- Helper functions are for policies, not for clients to call directly.
revoke execute on function public.sync_public_location(uuid) from public, anon, authenticated;
