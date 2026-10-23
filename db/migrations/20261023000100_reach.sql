-- i12farm · Phase 3 · Reach
-- Farmers without smartphones or data: SMS alerts, a USSD menu, vet requests,
-- and partner broadcasts.
--
-- * Every SMS goes through public.notifications (an outbox). Database
--   triggers queue messages in the same transaction as the event that caused
--   them (order paid, order ready, payout sent, vet request...), so nothing is
--   lost if the SMS provider is down. The server renders the text from the
--   translation files and sends it (src/domains/notifications).
-- * Opt-outs: a phone that sends STOP (or chooses it on USSD) gets no more
--   broadcasts. Transactional messages about the person's own orders still go.
-- * USSD actions run through functions that take the caller's phone number
--   (supplied by the mobile network) and only touch farms with that number.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value, note) values
  ('sms_daily_cap',            '1000',  'Most SMS sent per day (all kinds); the rest wait for tomorrow.'),
  ('sms_cost_kes',             '0.8',   'Estimated cost of one SMS, for budgets and partner previews (check your Africa''s Talking rate).'),
  ('ussd_code',                '"*384*12#"', 'USSD code shown in SMS. Placeholder until a code is leased.'),
  ('broadcast_max_recipients', '5000',  'Largest audience one broadcast may reach.'),
  ('vet_alert_max',            '10',    'How many vets in the county get an SMS for one request.')
on conflict (key) do nothing;

alter table public.profiles add column if not exists organisation text check (char_length(organisation) <= 120);
-- Partners and admins may set their organisation name (shown on broadcasts).
grant update (organisation) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Language and opt-outs per phone number
-- ---------------------------------------------------------------------------
create table public.phone_prefs (
  phone       text primary key check (phone ~ '^254[17][0-9]{8}$'),
  locale      text check (locale in ('en', 'sw')),
  sms_opt_out boolean not null default false,
  updated_at  timestamptz not null default now()
);

create table public.phone_pref_events (            -- append-only history of opt-outs
  id      bigint generated always as identity primary key,
  phone   text not null,
  action  text not null check (action in ('opt_out', 'opt_in', 'locale_en', 'locale_sw')),
  source  text not null check (source in ('sms', 'ussd', 'web', 'admin')),
  at      timestamptz not null default now()
);

alter table public.phone_prefs enable row level security;
alter table public.phone_pref_events enable row level security;
revoke all on public.phone_prefs, public.phone_pref_events from anon, authenticated;
create policy "admins read phone prefs" on public.phone_prefs for select to authenticated using (public.has_role('admin'));

create or replace function public.set_phone_pref(p_phone text, p_action text, p_source text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ph text := public.normalise_ke_phone(p_phone);
begin
  if ph is null then
    return;
  end if;
  insert into public.phone_prefs (phone) values (ph) on conflict (phone) do nothing;
  update public.phone_prefs
     set sms_opt_out = case p_action when 'opt_out' then true when 'opt_in' then false else sms_opt_out end,
         locale = case p_action when 'locale_en' then 'en' when 'locale_sw' then 'sw' else locale end,
         updated_at = now()
   where phone = ph;
  insert into public.phone_pref_events (phone, action, source) values (ph, p_action, p_source);
end;
$$;
revoke execute on function public.set_phone_pref(text, text, text) from public, anon, authenticated;

-- Language for a phone: the account's choice, else the USSD choice, else Kiswahili.
create or replace function public.phone_locale(p_phone text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.preferred_language from auth.users u join public.profiles p on p.id = u.id where u.phone = p_phone limit 1),
    (select x.locale from public.phone_prefs x where x.phone = p_phone),
    'sw');
$$;
revoke execute on function public.phone_locale(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Outbox
-- ---------------------------------------------------------------------------
create table public.notifications (
  id                  bigint generated always as identity primary key,
  channel             text not null default 'sms' check (channel in ('sms')),
  phone               text not null check (phone ~ '^254[17][0-9]{8}$'),
  template            text not null check (template ~ '^[a-z_]{2,40}$'),
  params              jsonb not null default '{}'::jsonb,
  locale              text not null default 'sw' check (locale in ('en', 'sw')),
  kind                text not null check (kind in ('transactional', 'broadcast')),
  order_id            uuid references public.orders (id) on delete set null,
  service_request_id  uuid,
  broadcast_id        uuid,
  status              text not null default 'queued'
                      check (status in ('queued', 'sending', 'sent', 'delivered', 'failed', 'skipped', 'simulated')),
  body                text,
  provider_id         text,
  cost_kes            numeric(8, 2),
  error               text,
  attempts            integer not null default 0,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  delivered_at        timestamptz
);
create index notifications_queue_idx on public.notifications (status, created_at) where status in ('queued', 'sending');
create index notifications_provider_idx on public.notifications (provider_id) where provider_id is not null;
create index notifications_broadcast_idx on public.notifications (broadcast_id, status);
create index notifications_time_idx on public.notifications (created_at);

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
create policy "admins read the outbox" on public.notifications for select to authenticated using (public.has_role('admin'));
grant select on public.notifications to authenticated;

create or replace function public.queue_sms(
  p_phone text, p_template text, p_params jsonb, p_kind text,
  p_order uuid default null, p_request uuid default null, p_broadcast uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  ph   text := public.normalise_ke_phone(p_phone);
  nid  bigint;
  out_ boolean;
begin
  if ph is null then
    return null;
  end if;
  select coalesce(sms_opt_out, false) into out_ from public.phone_prefs where phone = ph;
  insert into public.notifications (phone, template, params, locale, kind, order_id, service_request_id, broadcast_id, status)
  values (ph, p_template, coalesce(p_params, '{}'::jsonb), public.phone_locale(ph), p_kind, p_order, p_request, p_broadcast,
          case when p_kind = 'broadcast' and coalesce(out_, false) then 'skipped' else 'queued' end)
  returning id into nid;
  return nid;
end;
$$;
revoke execute on function public.queue_sms(text, text, jsonb, text, uuid, uuid, uuid) from public, anon, authenticated;

-- The farm's own number for alerts: the public phone, else WhatsApp, else the owner's sign-in phone.
create or replace function public.farm_alert_phone(fid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.normalise_ke_phone(f.phone_public), public.normalise_ke_phone(f.whatsapp),
                  (select u.phone from auth.users u where u.id = f.owner_id))
  from public.farms f where f.id = fid;
$$;
revoke execute on function public.farm_alert_phone(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Order and money alerts
-- ---------------------------------------------------------------------------
create or replace function public.orders_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  farm public.farms;
  n    integer;
begin
  if new.status is not distinct from old.status then
    return null;
  end if;
  select * into farm from public.farms where id = new.farm_id;
  select count(*) into n from public.order_items where order_id = new.id;

  if new.status = 'paid' then
    perform public.queue_sms(public.farm_alert_phone(new.farm_id), 'order_paid',
      jsonb_build_object('number', new.number, 'farm', farm.name, 'total', round(new.subtotal_kes), 'items', n,
                         'visit', new.visit_date),
      'transactional', new.id);
  elsif new.status = 'ready' then
    perform public.queue_sms(new.buyer_phone, 'order_ready',
      jsonb_build_object('number', new.number, 'farm', farm.name,
                         'phone', coalesce(farm.phone_public, farm.whatsapp, '')),
      'transactional', new.id);
  elsif new.status = 'declined' then
    perform public.queue_sms(new.buyer_phone, 'order_declined',
      jsonb_build_object('number', new.number, 'farm', farm.name), 'transactional', new.id);
  end if;
  return null;
end;
$$;

create trigger orders_notify
  after update of status on public.orders
  for each row execute function public.orders_notify();

create or replace function public.ledger_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
begin
  if new.kind = 'payout_sent' then
    perform public.queue_sms(public.farm_alert_phone(new.farm_id), 'payout_sent',
      jsonb_build_object('amount', round(new.amount_kes), 'ref', coalesce(new.reference, '')), 'transactional');
  elsif new.kind = 'refund_sent' and new.order_id is not null then
    select * into o from public.orders where id = new.order_id;
    perform public.queue_sms(o.buyer_phone, 'refund_sent',
      jsonb_build_object('amount', round(new.amount_kes), 'ref', coalesce(new.reference, ''), 'number', o.number),
      'transactional', o.id);
  end if;
  return null;
end;
$$;

create trigger ledger_notify
  after insert on public.ledger_entries
  for each row execute function public.ledger_notify();

-- ---------------------------------------------------------------------------
-- Vet requests
-- A farmer (web or USSD) asks for a vet. Vet-service farms in the same county
-- get an SMS; the first to accept gets the farmer's number and the farmer
-- gets the vet's name and number.
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value, note) values
  ('vet_request_hours', '48', 'Open vet requests nobody accepts expire after this many hours.')
on conflict (key) do nothing;

create sequence public.service_request_seq start 101;

create table public.service_requests (
  id             uuid primary key default gen_random_uuid(),
  number         text not null unique default ('V' || nextval('public.service_request_seq')::text),
  requester_id   uuid references public.profiles (id) on delete set null,
  contact_phone  text not null check (contact_phone ~ '^254[17][0-9]{8}$'),
  contact_name   text check (char_length(contact_name) <= 120),
  county_code    smallint not null references public.counties (code),
  place          text check (char_length(place) <= 120),
  animal         text not null references public.farm_categories (slug),
  description    text check (char_length(description) <= 500),
  urgency        text not null default 'today' check (urgency in ('today', 'this_week')),
  status         text not null default 'open' check (status in ('open', 'accepted', 'completed', 'cancelled', 'expired')),
  vet_farm_id    uuid references public.farms (id) on delete set null,
  vets_alerted   integer not null default 0,
  via            text not null default 'web' check (via in ('web', 'ussd')),
  created_at     timestamptz not null default now(),
  accepted_at    timestamptz,
  closed_at      timestamptz,
  constraint service_requests_vet check ((status in ('accepted', 'completed')) = (vet_farm_id is not null) or status in ('cancelled', 'expired'))
);
create index service_requests_open_idx on public.service_requests (county_code, status, created_at);
create index service_requests_requester_idx on public.service_requests (requester_id, created_at desc);
create index service_requests_vet_idx on public.service_requests (vet_farm_id, created_at desc);
create index service_requests_phone_idx on public.service_requests (contact_phone, status);

create table public.service_request_history (
  id          bigint generated always as identity primary key,
  request_id  uuid not null references public.service_requests (id) on delete cascade,
  from_status text,
  to_status   text not null,
  vet_farm_id uuid,
  actor_id    uuid,
  via         text,
  at          timestamptz not null default now()
);
create index service_request_history_idx on public.service_request_history (request_id, at);

alter table public.notifications
  add constraint notifications_request_fk foreign key (service_request_id) references public.service_requests (id) on delete set null;

alter table public.service_requests enable row level security;
alter table public.service_request_history enable row level security;
revoke all on public.service_requests, public.service_request_history from anon, authenticated;
grant select on public.service_requests to authenticated;
create policy "requesters and admins read requests" on public.service_requests for select to authenticated
  using (requester_id = auth.uid() or public.has_role('admin'));

-- Farms that offer vet services: published, with the vet-services category.
create or replace function public.is_vet_farm(fid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.farms f where f.id = fid and f.status = 'published' and 'vet-services' = any (f.categories));
$$;

create or replace function public.service_requests_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.service_request_history (request_id, from_status, to_status, vet_farm_id, actor_id, via)
    values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status, new.vet_farm_id, auth.uid(),
            nullif(current_setting('i12farm.via', true), ''));
  end if;
  return null;
end;
$$;
create trigger service_requests_history
  after insert or update on public.service_requests
  for each row execute function public.service_requests_history();

-- Alert vets in the county (verified first, then those who answered most recently).
create or replace function public.service_requests_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cap integer := public.setting_int('vet_alert_max', 10);
  v   record;
  n   integer := 0;
  animal_name jsonb;
begin
  select jsonb_build_object('en', c.name_en, 'sw', c.name_sw) into animal_name from public.farm_categories c where c.slug = new.animal;
  for v in
    select f.id, public.farm_alert_phone(f.id) as phone
    from public.farms f
    where f.status = 'published' and 'vet-services' = any (f.categories) and f.county_code = new.county_code
      and public.farm_alert_phone(f.id) is not null
      and public.farm_alert_phone(f.id) <> new.contact_phone
    order by f.verified_at is null,
             (select max(s.accepted_at) from public.service_requests s where s.vet_farm_id = f.id) desc nulls last,
             f.created_at
    limit cap
  loop
    perform public.queue_sms(v.phone, 'vet_request',
      jsonb_build_object('number', new.number, 'animal', animal_name,
                         'place', coalesce(new.place, (select c.name from public.counties c where c.code = new.county_code)),
                         'urgency', new.urgency, 'about', coalesce(left(new.description, 60), '')),
      'transactional', null, new.id);
    n := n + 1;
  end loop;
  update public.service_requests set vets_alerted = n where id = new.id;
  if new.via = 'ussd' then
    perform public.queue_sms(new.contact_phone, 'vet_request_received',
      jsonb_build_object('number', new.number, 'vets', n), 'transactional', null, new.id);
  end if;
  return null;
end;
$$;
create trigger service_requests_alert
  after insert on public.service_requests
  for each row execute function public.service_requests_alert();

-- Internal: create a request (checks shared by web and USSD).
create or replace function public.create_service_request(
  p_requester uuid, p_phone text, p_name text, p_county smallint, p_place text,
  p_animal text, p_description text, p_urgency text, p_via text
)
returns public.service_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  ph  text := public.normalise_ke_phone(p_phone);
  row public.service_requests;
begin
  if ph is null then
    raise exception 'A Kenyan mobile number is needed' using errcode = '22023';
  end if;
  if not exists (select 1 from public.counties where code = p_county) then
    raise exception 'Choose a county' using errcode = '22023';
  end if;
  if not exists (select 1 from public.farm_categories where slug = p_animal and slug <> 'vet-services') then
    raise exception 'Choose what the animals are' using errcode = '22023';
  end if;
  if (select count(*) from public.service_requests s where s.contact_phone = ph and s.status = 'open') >= 3 then
    raise exception 'You already have 3 open requests' using errcode = '54000';
  end if;
  perform set_config('i12farm.via', p_via, true);
  insert into public.service_requests (requester_id, contact_phone, contact_name, county_code, place, animal, description, urgency, via)
  values (p_requester, ph, nullif(trim(p_name), ''), p_county, nullif(trim(p_place), ''), p_animal,
          nullif(trim(p_description), ''), coalesce(p_urgency, 'today'), p_via)
  returning * into row;
  select * into row from public.service_requests where id = row.id;   -- vets_alerted set by trigger
  return row;
end;
$$;
revoke execute on function public.create_service_request(uuid, text, text, smallint, text, text, text, text, text) from public, anon, authenticated;

-- Web: payload { county_code, place, animal, description, urgency, contact_phone, contact_name }
create or replace function public.request_vet(payload jsonb)
returns table (id uuid, number text, vets_alerted integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  me  uuid := auth.uid();
  row public.service_requests;
  ph  text;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  ph := coalesce(nullif(payload ->> 'contact_phone', ''),
                 (select u.phone from auth.users u where u.id = me),
                 (select p.phone from public.profiles p where p.id = me));
  row := public.create_service_request(me, ph, payload ->> 'contact_name', (payload ->> 'county_code')::smallint,
           payload ->> 'place', payload ->> 'animal', payload ->> 'description',
           case when payload ->> 'urgency' = 'this_week' then 'this_week' else 'today' end, 'web');
  return query select row.id, row.number, row.vets_alerted;
end;
$$;
revoke execute on function public.request_vet(jsonb) from public, anon;
grant execute on function public.request_vet(jsonb) to authenticated;

-- Internal: a vet farm takes an open request.
create or replace function public.take_service_request(rid uuid, vet_farm uuid, p_via text)
returns public.service_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  r    public.service_requests;
  farm public.farms;
begin
  select * into r from public.service_requests s where s.id = rid for update;
  if not found then
    raise exception 'No such request' using errcode = 'P0002';
  end if;
  select * into farm from public.farms f where f.id = vet_farm;
  if not public.is_vet_farm(vet_farm) or farm.county_code <> r.county_code then
    raise exception 'Only vets in % county can take this request', r.county_code using errcode = '42501';
  end if;
  if r.status <> 'open' then
    raise exception 'Another vet has already taken this request' using errcode = '55000';
  end if;
  perform set_config('i12farm.via', p_via, true);
  update public.service_requests s set status = 'accepted', vet_farm_id = vet_farm, accepted_at = now()
   where s.id = rid returning * into r;
  perform public.queue_sms(r.contact_phone, 'vet_accepted',
    jsonb_build_object('number', r.number, 'vet', coalesce(farm.farmer_name, farm.name), 'farm', farm.name,
                       'phone', coalesce(public.farm_alert_phone(farm.id), '')),
    'transactional', null, r.id);
  return r;
end;
$$;
revoke execute on function public.take_service_request(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.accept_service_request(rid uuid, vet_farm uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_farm(vet_farm) then
    raise exception 'Not your farm' using errcode = '42501';
  end if;
  return (public.take_service_request(rid, vet_farm, 'web')).status;
end;
$$;
revoke execute on function public.accept_service_request(uuid, uuid) from public, anon;
grant execute on function public.accept_service_request(uuid, uuid) to authenticated;

-- Requester cancels (open or accepted); the vet marks done; admins do either.
create or replace function public.close_service_request(rid uuid, outcome text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r   public.service_requests;
  me  uuid := auth.uid();
  ok  boolean;
begin
  select * into r from public.service_requests s where s.id = rid for update;
  if not found then
    raise exception 'No such request' using errcode = 'P0002';
  end if;
  ok := (outcome = 'cancelled' and r.status in ('open', 'accepted') and (r.requester_id = me or public.has_role('admin')))
     or (outcome = 'completed' and r.status = 'accepted'
         and (public.can_manage_farm(r.vet_farm_id) or r.requester_id = me or public.has_role('admin')));
  if me is null or not ok then
    raise exception 'Cannot mark this request %', outcome using errcode = '42501';
  end if;
  perform set_config('i12farm.via', 'web', true);
  update public.service_requests s set status = outcome, closed_at = now() where s.id = rid;
  if outcome = 'cancelled' and r.status = 'accepted' then
    perform public.queue_sms(public.farm_alert_phone(r.vet_farm_id), 'vet_cancelled',
      jsonb_build_object('number', r.number), 'transactional', null, r.id);
  end if;
  return outcome;
end;
$$;
revoke execute on function public.close_service_request(uuid, text) from public, anon;
grant execute on function public.close_service_request(uuid, text) to authenticated;

-- What a vet sees: open requests in the counties of the vet farms I manage
-- (no phone number until accepted), and the requests my farms have taken.
create or replace function public.vet_requests_for_me()
returns table (
  id uuid, number text, status text, county_code smallint, county_name text, place text, animal text,
  description text, urgency text, contact_name text, contact_phone text, vet_farm_id uuid, vet_farm_name text,
  created_at timestamptz, accepted_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select f.id, f.name, f.county_code from public.farms f
    where (f.owner_id = auth.uid() or f.managed_by = auth.uid())
      and f.status = 'published' and 'vet-services' = any (f.categories)
  )
  select s.id, s.number, s.status, s.county_code, c.name, s.place, s.animal, s.description, s.urgency,
         case when s.vet_farm_id in (select id from mine) then s.contact_name end,
         case when s.vet_farm_id in (select id from mine) then s.contact_phone end,
         s.vet_farm_id, (select m.name from mine m where m.id = s.vet_farm_id),
         s.created_at, s.accepted_at
  from public.service_requests s
  join public.counties c on c.code = s.county_code
  where auth.uid() is not null
    and ((s.status = 'open' and s.county_code in (select county_code from mine))
         or s.vet_farm_id in (select id from mine))
  order by s.status <> 'open', s.created_at desc
  limit 100;
$$;
revoke execute on function public.vet_requests_for_me() from public, anon;
grant execute on function public.vet_requests_for_me() to authenticated;

-- What a requester sees: own requests with the vet's details once accepted.
create or replace function public.my_service_requests()
returns table (
  id uuid, number text, status text, county_name text, place text, animal text, description text, urgency text,
  vets_alerted integer, vet_name text, vet_farm_slug text, vet_phone text, created_at timestamptz, accepted_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.number, s.status, c.name, s.place, s.animal, s.description, s.urgency, s.vets_alerted,
         coalesce(f.farmer_name, f.name), f.slug, public.farm_alert_phone(f.id), s.created_at, s.accepted_at
  from public.service_requests s
  join public.counties c on c.code = s.county_code
  left join public.farms f on f.id = s.vet_farm_id
  where s.requester_id = auth.uid()
  order by s.created_at desc
  limit 50;
$$;
revoke execute on function public.my_service_requests() from public, anon;
grant execute on function public.my_service_requests() to authenticated;

-- ---------------------------------------------------------------------------
-- Partner broadcasts
-- A partner (county extension office, cooperative, NGO) writes one SMS in
-- English and Kiswahili and picks an audience. An admin reviews it; on
-- approval one SMS per farm phone is queued, in each phone's language.
-- Phones that sent STOP are skipped.
-- ---------------------------------------------------------------------------
create table public.broadcasts (
  id                    uuid primary key default gen_random_uuid(),
  created_by            uuid not null references public.profiles (id) on delete cascade,
  organisation          text not null check (char_length(organisation) between 2 and 60),
  body_en               text not null check (char_length(body_en) between 10 and 300),
  body_sw               text not null check (char_length(body_sw) between 10 and 300),
  counties              smallint[] not null default '{}',     -- empty = every county
  categories            text[] not null default '{}',         -- empty = every kind of farm
  verified_only         boolean not null default false,
  status                text not null default 'pending_review'
                        check (status in ('pending_review', 'approved', 'rejected', 'cancelled', 'sent')),
  estimated_recipients  integer not null default 0,
  recipients            integer,
  review_note           text check (char_length(review_note) <= 500),
  reviewed_by           uuid references public.profiles (id) on delete set null,
  reviewed_at           timestamptz,
  sent_at               timestamptz,
  created_at            timestamptz not null default now()
);
create index broadcasts_creator_idx on public.broadcasts (created_by, created_at desc);
create index broadcasts_status_idx on public.broadcasts (status, created_at);

alter table public.notifications
  add constraint notifications_broadcast_fk foreign key (broadcast_id) references public.broadcasts (id) on delete set null;

alter table public.broadcasts enable row level security;
revoke all on public.broadcasts from anon, authenticated;
grant select on public.broadcasts to authenticated;
create policy "authors and admins read broadcasts" on public.broadcasts for select to authenticated
  using (created_by = auth.uid() or public.has_role('admin'));

-- Distinct farm phones matching an audience.
create or replace function public.broadcast_phones(p_counties smallint[], p_categories text[], p_verified boolean)
returns table (phone text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct public.farm_alert_phone(f.id)
  from public.farms f
  where f.status = 'published'
    and (coalesce(cardinality(p_counties), 0) = 0 or f.county_code = any (p_counties))
    and (coalesce(cardinality(p_categories), 0) = 0 or f.categories && p_categories)
    and (not coalesce(p_verified, false) or f.verified_at is not null)
    and public.farm_alert_phone(f.id) is not null;
$$;
revoke execute on function public.broadcast_phones(smallint[], text[], boolean) from public, anon, authenticated;

-- Audience preview for partners: how many phones, how many have opted out, est. cost.
create or replace function public.broadcast_audience(p_counties smallint[], p_categories text[], p_verified boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  total   integer;
  stopped integer;
begin
  if not (public.has_role('partner') or public.has_role('admin')) then
    raise exception 'Partners only' using errcode = '42501';
  end if;
  select count(*), count(*) filter (where x.sms_opt_out)
    into total, stopped
  from public.broadcast_phones(p_counties, p_categories, p_verified) b
  left join public.phone_prefs x on x.phone = b.phone;
  return jsonb_build_object('phones', total, 'opted_out', stopped, 'reach', total - stopped,
    'cost_kes', round((total - stopped) * coalesce((select (value #>> '{}')::numeric from public.platform_settings where key = 'sms_cost_kes'), 0.8), 2),
    'max', public.setting_int('broadcast_max_recipients', 5000));
end;
$$;
revoke execute on function public.broadcast_audience(smallint[], text[], boolean) from public, anon;
grant execute on function public.broadcast_audience(smallint[], text[], boolean) to authenticated;

-- payload { organisation, body_en, body_sw, counties: [..], categories: [..], verified_only }
create or replace function public.create_broadcast(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me    uuid := auth.uid();
  cs    smallint[] := coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(coalesce(payload -> 'counties', '[]')) x), '{}');
  cats  text[]     := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(payload -> 'categories', '[]')) x), '{}');
  ver   boolean    := coalesce((payload ->> 'verified_only')::boolean, false);
  aud   jsonb;
  bid   uuid;
begin
  if me is null or not (public.has_role('partner') or public.has_role('admin')) then
    raise exception 'Partners only' using errcode = '42501';
  end if;
  if (select count(*) from public.broadcasts b where b.created_by = me and b.status = 'pending_review') >= 3 then
    raise exception 'You have 3 messages waiting for review already' using errcode = '54000';
  end if;
  if exists (select 1 from unnest(cats) c where c not in (select slug from public.farm_categories)) then
    raise exception 'Unknown farm type' using errcode = '22023';
  end if;
  aud := public.broadcast_audience(cs, cats, ver);
  if (aud ->> 'reach')::integer = 0 then
    raise exception 'No farms match this audience' using errcode = '22023';
  end if;
  if (aud ->> 'phones')::integer > (aud ->> 'max')::integer then
    raise exception 'Audience is larger than % phones; narrow it down', aud ->> 'max' using errcode = '54000';
  end if;
  insert into public.broadcasts (created_by, organisation, body_en, body_sw, counties, categories, verified_only, estimated_recipients)
  values (me, trim(payload ->> 'organisation'), trim(payload ->> 'body_en'), trim(payload ->> 'body_sw'), cs, cats, ver,
          (aud ->> 'reach')::integer)
  returning id into bid;
  return bid;
end;
$$;
revoke execute on function public.create_broadcast(jsonb) from public, anon;
grant execute on function public.create_broadcast(jsonb) to authenticated;

create or replace function public.cancel_broadcast(bid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.broadcasts b set status = 'cancelled'
   where b.id = bid and b.status = 'pending_review' and (b.created_by = auth.uid() or public.has_role('admin'));
  if not found then
    raise exception 'Only messages waiting for review can be withdrawn' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.cancel_broadcast(uuid) from public, anon;
grant execute on function public.cancel_broadcast(uuid) to authenticated;

-- Admin: approve (queues the SMS) or reject.
create or replace function public.admin_review_broadcast(bid uuid, approve boolean, note text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  b  public.broadcasts;
  n  integer := 0;
  ph text;
begin
  perform public.require_admin();
  select * into b from public.broadcasts x where x.id = bid for update;
  if not found or b.status <> 'pending_review' then
    raise exception 'This message is not waiting for review' using errcode = '55000';
  end if;
  if not approve then
    update public.broadcasts x set status = 'rejected', review_note = left(note, 500), reviewed_by = auth.uid(), reviewed_at = now()
     where x.id = bid;
    return 0;
  end if;
  for ph in select p.phone from public.broadcast_phones(b.counties, b.categories, b.verified_only) p loop
    if public.queue_sms(ph, 'broadcast', jsonb_build_object('org', b.organisation), 'broadcast', null, null, bid) is not null then
      n := n + 1;
    end if;
  end loop;
  update public.broadcasts x
     set status = 'sent', review_note = left(note, 500), reviewed_by = auth.uid(), reviewed_at = now(), sent_at = now(),
         recipients = (select count(*) from public.notifications m where m.broadcast_id = bid and m.status <> 'skipped')
   where x.id = bid;
  return (select recipients from public.broadcasts where id = bid);
end;
$$;
revoke execute on function public.admin_review_broadcast(uuid, boolean, text) from public, anon;
grant execute on function public.admin_review_broadcast(uuid, boolean, text) to authenticated;

-- Delivery numbers for one broadcast (its author or an admin).
create or replace function public.broadcast_stats(bid uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when exists (select 1 from public.broadcasts b where b.id = bid and (b.created_by = auth.uid() or public.has_role('admin')))
  then (select jsonb_build_object(
          'queued',    count(*) filter (where status in ('queued', 'sending')),
          'sent',      count(*) filter (where status in ('sent', 'simulated')),
          'delivered', count(*) filter (where status = 'delivered'),
          'failed',    count(*) filter (where status = 'failed'),
          'skipped',   count(*) filter (where status = 'skipped'),
          'cost_kes',  coalesce(sum(cost_kes), 0))
        from public.notifications where broadcast_id = bid)
  end;
$$;
revoke execute on function public.broadcast_stats(uuid) from public, anon;
grant execute on function public.broadcast_stats(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- USSD
-- Called by the server's USSD route with the caller's phone number (given by
-- the network, so it cannot be typed in by someone else). Not callable by
-- users. A caller "owns" a farm when its public phone or WhatsApp number is
-- theirs, or when they sign in with that phone and own or manage the farm.
-- ---------------------------------------------------------------------------
create or replace function public.ussd_user(p_phone text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id from auth.users u where u.phone = public.normalise_ke_phone(p_phone) and u.status = 'active' limit 1;
$$;
revoke execute on function public.ussd_user(text) from public, anon, authenticated;

create or replace function public.ussd_farms(p_phone text)
returns table (id uuid, name text, county_code smallint, vet boolean)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.name, f.county_code, (f.status = 'published' and 'vet-services' = any (f.categories))
  from public.farms f
  where f.status <> 'suspended'
    and (public.normalise_ke_phone(f.phone_public) = public.normalise_ke_phone(p_phone)
         or public.normalise_ke_phone(f.whatsapp) = public.normalise_ke_phone(p_phone)
         or f.owner_id = public.ussd_user(p_phone)
         or f.managed_by = public.ussd_user(p_phone))
  order by f.name, f.id
  limit 9;
$$;
revoke execute on function public.ussd_farms(text) from public, anon, authenticated;

create or replace function public.ussd_context(p_phone text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'phone', public.normalise_ke_phone(p_phone),
    'user_id', public.ussd_user(p_phone),
    'locale', public.phone_locale(public.normalise_ke_phone(p_phone)),
    'opted_out', coalesce((select x.sms_opt_out from public.phone_prefs x where x.phone = public.normalise_ke_phone(p_phone)), false),
    'farms', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'county', f.county_code, 'vet', f.vet))
                       from public.ussd_farms(p_phone) f), '[]'::jsonb),
    'county', coalesce((select f.county_code from public.ussd_farms(p_phone) f limit 1),
                       (select p.county_code from public.profiles p where p.id = public.ussd_user(p_phone))));
$$;
revoke execute on function public.ussd_context(text) from public, anon, authenticated;

-- Orders that need the farmer: paid (accept or decline) and accepted (mark ready).
create or replace function public.ussd_open_orders(p_phone text)
returns table (id uuid, number text, status public.order_status, farm text, total numeric, summary text, visit_date date)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.number, o.status, f.name, o.subtotal_kes,
         (select string_agg(round(i.quantity)::text || ' ' || left(i.title, 20), ', ' order by i.title)
            from public.order_items i where i.order_id = o.id),
         o.visit_date
  from public.orders o
  join public.farms f on f.id = o.farm_id
  where o.farm_id in (select x.id from public.ussd_farms(p_phone) x)
    and o.status in ('paid', 'accepted')
  order by o.paid_at, o.id
  limit 5;
$$;
revoke execute on function public.ussd_open_orders(text) from public, anon, authenticated;

create or replace function public.ussd_order_action(p_phone text, p_number text, p_action text)
returns public.order_status
language plpgsql
security definer
set search_path = public
as $$
declare
  o   public.orders;
  uid uuid := public.ussd_user(p_phone);
  to_ public.order_status;
begin
  select * into o from public.orders x
   where x.number = upper(p_number) and x.farm_id in (select f.id from public.ussd_farms(p_phone) f)
   for update;
  if not found then
    raise exception 'No such order' using errcode = 'P0002';
  end if;
  to_ := case
    when p_action = 'accept'  and o.status = 'paid'                    then 'accepted'
    when p_action = 'decline' and o.status in ('paid', 'accepted')     then 'declined'
    when p_action = 'ready'   and o.status = 'accepted'                then 'ready'
  end::public.order_status;
  if to_ is null then
    raise exception 'Cannot % an order that is %', p_action, o.status using errcode = '42501';
  end if;
  -- Recorded against the caller's account, if they have one.
  perform set_config('app.user_id', coalesce(uid::text, ''), true);
  perform public.apply_order_status(o.id, to_, 'via USSD', uid);
  perform set_config('app.user_id', '', true);
  return to_;
end;
$$;
revoke execute on function public.ussd_order_action(text, text, text) from public, anon, authenticated;

create or replace function public.ussd_listings(p_phone text)
returns table (id uuid, title text, unit text, price_kes numeric, quantity numeric, farm text)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.title, l.unit, l.price_kes, l.quantity, f.name
  from public.listings l
  join public.farms f on f.id = l.farm_id
  where l.farm_id in (select x.id from public.ussd_farms(p_phone) x)
    and l.status in ('active', 'sold_out', 'paused')
  order by f.name, l.title, l.id
  limit 8;
$$;
revoke execute on function public.ussd_listings(text) from public, anon, authenticated;

create or replace function public.ussd_update_listing(p_phone text, p_listing uuid, p_price numeric, p_quantity numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_price is not null and (p_price < 0 or p_price > 10000000) then
    raise exception 'Price out of range' using errcode = '22023';
  end if;
  if p_quantity is not null and (p_quantity < 0 or p_quantity > 1000000) then
    raise exception 'Quantity out of range' using errcode = '22023';
  end if;
  update public.listings l
     set price_kes = coalesce(p_price, l.price_kes),
         quantity  = coalesce(p_quantity, l.quantity),
         status    = case when p_quantity is null then l.status
                          when p_quantity = 0 and l.status = 'active' then 'sold_out'::public.listing_status
                          when p_quantity > 0 and l.status = 'sold_out' then 'active'::public.listing_status
                          else l.status end
   where l.id = p_listing and l.farm_id in (select f.id from public.ussd_farms(p_phone) f);
  if not found then
    raise exception 'No such listing' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.ussd_update_listing(text, uuid, numeric, numeric) from public, anon, authenticated;

create or replace function public.ussd_request_vet(p_phone text, p_county smallint, p_animal text, p_urgency text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.service_requests;
begin
  r := public.create_service_request(public.ussd_user(p_phone), p_phone, null, p_county,
         (select f.name from public.ussd_farms(p_phone) f limit 1), p_animal, null, p_urgency, 'ussd');
  return jsonb_build_object('number', r.number, 'vets', r.vets_alerted);
end;
$$;
revoke execute on function public.ussd_request_vet(text, smallint, text, text) from public, anon, authenticated;

-- For vets on USSD: open requests in their counties.
create or replace function public.ussd_vet_requests(p_phone text)
returns table (id uuid, number text, animal text, place text, urgency text, county_code smallint)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.number, s.animal, coalesce(s.place, c.name), s.urgency, s.county_code
  from public.service_requests s
  join public.counties c on c.code = s.county_code
  where s.status = 'open'
    and s.county_code in (select f.county_code from public.ussd_farms(p_phone) f where f.vet)
  order by s.urgency = 'this_week', s.created_at
  limit 5;
$$;
revoke execute on function public.ussd_vet_requests(text) from public, anon, authenticated;

create or replace function public.ussd_take_request(p_phone text, p_number text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rid  uuid;
  farm uuid;
  r    public.service_requests;
begin
  select s.id into rid from public.service_requests s where s.number = upper(p_number);
  select f.id into farm from public.ussd_farms(p_phone) f
   where f.vet and f.county_code = (select county_code from public.service_requests where id = rid) limit 1;
  if rid is null or farm is null then
    raise exception 'No such request' using errcode = 'P0002';
  end if;
  perform set_config('app.user_id', coalesce(public.ussd_user(p_phone)::text, ''), true);
  r := public.take_service_request(rid, farm, 'ussd');
  perform set_config('app.user_id', '', true);
  return jsonb_build_object('number', r.number, 'phone', r.contact_phone, 'name', r.contact_name, 'place', r.place);
end;
$$;
revoke execute on function public.ussd_take_request(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Upkeep (replaces the Phase 2b version): also expires stale vet requests
-- and gives up on SMS stuck in "sending".
-- ---------------------------------------------------------------------------
create or replace function public.run_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  days     integer := public.setting_int('auto_complete_days', 3);
  hours    integer := public.setting_int('unpaid_cancel_hours', 48);
  vet_h    integer := public.setting_int('vet_request_hours', 48);
  r        record;
  done     integer := 0;
  dropped  integer := 0;
  expired  integer := 0;
  ended    integer := 0;
  vets     integer := 0;
  stuck    integer := 0;
begin
  for r in
    select o.id from public.orders o
    where o.status = 'ready'
      and (select max(h.at) from public.order_status_history h where h.order_id = o.id and h.to_status = 'ready')
          < now() - make_interval(days => days)
    for update skip locked
  loop
    perform public.apply_order_status(r.id, 'completed', format('Completed automatically %s days after it was ready', days), null);
    done := done + 1;
  end loop;

  for r in
    select o.id from public.orders o
    where o.status = 'awaiting_payment'
      and o.created_at < now() - make_interval(hours => hours)
      and not exists (select 1 from public.payments p
                       where p.order_id = o.id and p.status = 'requested' and p.requested_at > now() - interval '10 minutes')
    for update skip locked
  loop
    perform public.apply_order_status(r.id, 'cancelled', format('Not paid within %s hours', hours), null);
    dropped := dropped + 1;
  end loop;

  update public.payments p
     set status = 'expired', result_desc = 'No answer from M-Pesa', completed_at = now()
   where p.status = 'requested' and p.requested_at < now() - interval '1 hour';
  get diagnostics expired = row_count;

  update public.farm_promotions x set status = 'expired' where x.status = 'active' and x.ends_at <= now();
  get diagnostics ended = row_count;
  update public.farm_promotions x set status = 'cancelled'
   where x.status = 'awaiting_payment' and x.created_at < now() - interval '1 day';

  perform set_config('i12farm.via', 'system', true);
  update public.service_requests s set status = 'expired', closed_at = now()
   where s.status = 'open' and s.created_at < now() - make_interval(hours => vet_h);
  get diagnostics vets = row_count;

  update public.notifications n set status = 'failed', error = coalesce(n.error, 'Stuck while sending')
   where n.status = 'sending' and coalesce(n.sent_at, n.created_at) < now() - interval '1 hour';
  get diagnostics stuck = row_count;

  return jsonb_build_object('auto_completed', done, 'unpaid_cancelled', dropped,
                            'payments_expired', expired, 'promotions_ended', ended,
                            'vet_requests_expired', vets, 'sms_stuck', stuck, 'ran_at', now());
end;
$$;
revoke execute on function public.run_maintenance() from public, anon, authenticated;
