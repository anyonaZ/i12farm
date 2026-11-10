-- i12farm · Phase 6 · Keep people informed, keep spam out
-- 1. Web push notifications (free; Android Chrome and desktop browsers):
--    subscriptions per device, preferences per person, an outbox filled by
--    database triggers in the same transaction as the event, sent by the server.
-- 2. Safety: report a farm (a farm reported by 3 different people is hidden
--    until an admin looks), limits on new farms and on sign-ups per network.

-- ---------------------------------------------------------------------------
-- Push subscriptions and preferences
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  endpoint     text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh       text not null check (char_length(p256dh) between 40 and 200),
  auth_secret  text not null check (char_length(auth_secret) between 10 and 100),
  user_agent   text check (char_length(user_agent) <= 300),
  created_at   timestamptz not null default now(),
  last_sent_at timestamptz,
  failures     integer not null default 0,
  disabled_at  timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id) where disabled_at is null;
alter table public.push_subscriptions enable row level security;
revoke insert, update, delete on public.push_subscriptions from anon, authenticated;
create policy "own push subscriptions" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());

alter table public.profiles add column push_prefs jsonb not null
  default '{"orders": true, "messages": true, "vets": true, "payouts": true}';

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_agent text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if (select count(*) from public.push_subscriptions s where s.user_id = auth.uid() and s.disabled_at is null) >= 10
     and not exists (select 1 from public.push_subscriptions s where s.endpoint = p_endpoint) then
    raise exception 'Notifications are on for 10 devices already' using errcode = '54000';
  end if;
  -- A device belongs to whoever signed in on it last (agents share phones).
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_secret, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_agent, 300))
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth_secret = excluded.auth_secret,
    user_agent = excluded.user_agent, failures = 0, disabled_at = null;
end;
$$;
revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_subscriptions s where s.endpoint = p_endpoint and s.user_id = auth.uid();
$$;
revoke execute on function public.remove_push_subscription(text) from public, anon;
grant execute on function public.remove_push_subscription(text) to authenticated;

create or replace function public.set_push_prefs(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'orders', coalesce((p ->> 'orders')::boolean, true), 'messages', coalesce((p ->> 'messages')::boolean, true),
           'vets', coalesce((p ->> 'vets')::boolean, true), 'payouts', coalesce((p ->> 'payouts')::boolean, true))
    into clean;
  update public.profiles set push_prefs = clean where id = auth.uid();
  return clean;
end;
$$;
revoke execute on function public.set_push_prefs(jsonb) from public, anon;
grant execute on function public.set_push_prefs(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Outbox. Text is written by the server from messages/*.json ("push") in the
-- person's language, so rows hold a template name and parameters only.
-- ---------------------------------------------------------------------------
create table public.push_outbox (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  topic       text not null check (topic in ('orders', 'messages', 'vets', 'payouts')),
  template    text not null check (template ~ '^[a-zA-Z]{2,40}$'),
  params      jsonb not null default '{}',
  url         text not null check (url ~ '^/' and char_length(url) <= 200),
  dedupe_key  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  attempts    integer not null default 0,
  last_error  text
);
create index push_outbox_pending_idx on public.push_outbox (created_at) where sent_at is null;
create unique index push_outbox_dedupe_idx on public.push_outbox (user_id, dedupe_key) where dedupe_key is not null and sent_at is null;
alter table public.push_outbox enable row level security;
revoke all on public.push_outbox from anon, authenticated;

create or replace function public.queue_push(p_user uuid, p_topic text, p_template text, p_params jsonb, p_url text, p_dedupe text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null then
    return;
  end if;
  -- Only for people who have notifications on somewhere and want this topic.
  if not exists (select 1 from public.push_subscriptions s where s.user_id = p_user and s.disabled_at is null)
     or coalesce((select (p.push_prefs ->> p_topic)::boolean from public.profiles p where p.id = p_user), true) is false then
    return;
  end if;
  insert into public.push_outbox (user_id, topic, template, params, url, dedupe_key)
  values (p_user, p_topic, p_template, coalesce(p_params, '{}'), p_url, p_dedupe)
  on conflict (user_id, dedupe_key) where dedupe_key is not null and sent_at is null do nothing;
end;
$$;
revoke execute on function public.queue_push(uuid, text, text, jsonb, text, text) from public, anon, authenticated;

-- People who look after a farm (owner and managing agent).
create or replace function public.farm_people(fid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct x from public.farms f, unnest(array[f.owner_id, f.managed_by]) x where f.id = fid and x is not null;
$$;
revoke execute on function public.farm_people(uuid) from public, anon, authenticated;

-- Orders: the farm hears about new paid orders; the buyer about answers.
create or replace function public.orders_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who uuid;
  farm_name text := (select name from public.farms where id = new.farm_id);
  url text := '/orders/' || new.number;
begin
  if new.status is not distinct from old.status then
    return null;
  end if;
  if new.status = 'paid' then
    for who in select public.farm_people(new.farm_id) loop
      perform public.queue_push(who, 'orders', 'orderPaid',
        jsonb_build_object('number', new.number, 'total', round(new.subtotal_kes)::text), url, 'order:' || new.id);
    end loop;
  elsif new.status in ('accepted', 'ready', 'declined') then
    perform public.queue_push(new.buyer_id, 'orders',
      case new.status when 'accepted' then 'orderAccepted' when 'ready' then 'orderReady' else 'orderDeclined' end,
      jsonb_build_object('number', new.number, 'farm', farm_name), url);
  end if;
  return null;
end;
$$;
create trigger orders_push after update of status on public.orders for each row execute function public.orders_push();

-- Messages: the other side, at most one waiting notification per conversation.
create or replace function public.messages_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c   public.conversations;
  who uuid;
  farm_name text;
begin
  if new.kind <> 'text' then
    return null;   -- order updates have their own notifications
  end if;
  select * into c from public.conversations where id = new.conversation_id;
  select name into farm_name from public.farms where id = c.farm_id;
  if new.sender_id = c.buyer_id then
    for who in select public.farm_people(c.farm_id) loop
      if who <> new.sender_id then
        perform public.queue_push(who, 'messages', 'messageToFarm',
          jsonb_build_object('farm', farm_name, 'text', left(new.body, 80)), '/inbox/' || c.id, 'conv:' || c.id);
      end if;
    end loop;
  else
    perform public.queue_push(c.buyer_id, 'messages', 'messageToBuyer',
      jsonb_build_object('farm', farm_name, 'text', left(new.body, 80)), '/inbox/' || c.id, 'conv:' || c.id);
  end if;
  return null;
end;
$$;
create trigger messages_push after insert on public.messages for each row execute function public.messages_push();

-- Vet requests: vets in the county hear about new ones; the farmer hears when a vet takes it.
create or replace function public.service_requests_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who uuid;
  vet_name text;
begin
  if tg_op = 'INSERT' then
    for who in
      select distinct p from public.farms f, public.farm_people(f.id) p
      where f.status = 'published' and 'vet-services' = any (f.categories) and f.county_code = new.county_code
        and p is distinct from new.requester_id
    loop
      perform public.queue_push(who, 'vets', 'vetRequest',
        jsonb_build_object('animal', new.animal, 'place', coalesce(new.place, ''), 'urgency', new.urgency), '/vets', 'vetreq:' || new.id);
    end loop;
  elsif new.status = 'accepted' and old.status = 'open' then
    select name into vet_name from public.farms where id = new.vet_farm_id;
    perform public.queue_push(new.requester_id, 'vets', 'vetAccepted', jsonb_build_object('vet', vet_name), '/vets');
  end if;
  return null;
end;
$$;
create trigger service_requests_push after insert or update of status on public.service_requests
  for each row execute function public.service_requests_push();

-- Payouts: the farm hears when money was sent.
create or replace function public.disbursements_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who uuid;
begin
  if new.kind = 'payout' and new.status = 'completed' and old.status is distinct from 'completed' then
    for who in select public.farm_people(new.farm_id) loop
      perform public.queue_push(who, 'payouts', 'payoutSent',
        jsonb_build_object('amount', round(new.amount_kes - new.fee_kes)::text), '/my-farm/' || new.farm_id || '/payouts');
    end loop;
  end if;
  return null;
end;
$$;
create trigger disbursements_push after update of status on public.disbursements for each row execute function public.disbursements_push();

-- For the server's sender.
create or replace function public.claim_push_batch(p_limit integer default 100)
returns table (id bigint, user_id uuid, topic text, template text, params jsonb, url text, locale text,
               subscriptions jsonb)
language sql
security definer
set search_path = public
as $$
  with picked as (
    select o.id from public.push_outbox o
    where o.sent_at is null and o.attempts < 5 and o.created_at > now() - interval '2 days'
    order by o.created_at
    limit p_limit
    for update skip locked
  ), bumped as (
    update public.push_outbox o set attempts = o.attempts + 1 from picked where o.id = picked.id returning o.*
  )
  select b.id, b.user_id, b.topic, b.template, b.params, b.url, coalesce(p.preferred_language, 'en'),
         coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth_secret))
                     from public.push_subscriptions s where s.user_id = b.user_id and s.disabled_at is null), '[]')
  from bumped b join public.profiles p on p.id = b.user_id;
$$;
revoke execute on function public.claim_push_batch(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Upkeep: the 6-hour nudge to farms that haven't answered a paid order comes
-- back as a notification; old outbox rows are cleared.
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value, note) values
  ('paid_reminder_hours', '6', 'Hours after payment before the farm gets a reminder notification to accept or decline.')
on conflict (key) do nothing;

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
  drop_h   integer := public.setting_int('paid_decline_hours', 36);
  remind_h integer := public.setting_int('paid_reminder_hours', 6);
  keep_d   integer := public.setting_int('search_log_days', 180);
  r        record;
  who      uuid;
  done     integer := 0;
  dropped  integer := 0;
  expired  integer := 0;
  ended    integer := 0;
  vets     integer := 0;
  declined integer := 0;
  pruned   integer := 0;
  reminded integer := 0;
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

  for r in
    select o.id, o.farm_id, o.number from public.orders o
    where o.status = 'paid' and o.farm_reminded_at is null
      and o.paid_at < now() - make_interval(hours => remind_h) and o.paid_at > now() - make_interval(hours => drop_h)
    for update skip locked
  loop
    for who in select public.farm_people(r.farm_id) loop
      perform public.queue_push(who, 'orders', 'orderWaiting', jsonb_build_object('number', r.number), '/orders/' || r.number);
    end loop;
    update public.orders set farm_reminded_at = now() where id = r.id;
    reminded := reminded + 1;
  end loop;

  for r in
    select o.id from public.orders o
    where o.status = 'paid' and o.paid_at < now() - make_interval(hours => drop_h)
    for update skip locked
  loop
    perform public.apply_order_status(r.id, 'declined', format('The farm did not answer within %s hours', drop_h), null);
    declined := declined + 1;
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

  delete from public.search_log l where l.searched_at < now() - make_interval(days => keep_d);
  get diagnostics pruned = row_count;
  delete from public.push_outbox o where o.created_at < now() - interval '30 days';

  return jsonb_build_object('auto_completed', done, 'unpaid_cancelled', dropped, 'farms_reminded', reminded,
                            'unanswered_declined', declined, 'payments_expired', expired, 'promotions_ended', ended,
                            'vet_requests_expired', vets, 'search_log_pruned', pruned, 'ran_at', now());
end;
$$;
revoke execute on function public.run_maintenance() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Safety: reports
-- ---------------------------------------------------------------------------
insert into public.platform_settings (key, value, note) values
  ('report_hide_threshold', '3', 'Different people reporting a farm before it is hidden until an admin looks.'),
  ('new_farms_per_day', '3', 'Farms one account (not agents or admins) may create in 24 hours.'),
  ('signups_per_network_hour', '5', 'New accounts from one network (IP address) per hour.')
on conflict (key) do nothing;

create table public.farm_reports (
  id           uuid primary key default gen_random_uuid(),
  farm_id      uuid not null references public.farms (id) on delete cascade,
  reporter_id  uuid references public.profiles (id) on delete set null,
  reason       text not null check (reason in ('fake', 'scam', 'wrong_info', 'offensive', 'other')),
  note         text check (char_length(note) <= 500),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references public.profiles (id) on delete set null,
  resolution   text check (resolution in ('dismissed', 'suspended', 'restored'))
);
create unique index farm_reports_one_open_idx on public.farm_reports (farm_id, reporter_id) where resolved_at is null;
alter table public.farm_reports enable row level security;
revoke insert, update, delete on public.farm_reports from anon, authenticated;
create policy "reports to admins" on public.farm_reports for select to authenticated using (public.has_role('admin'));

-- Admins, and the reporting system, may hide a farm.
create or replace function public.farms_guard_status()
returns trigger
language plpgsql
as $$
begin
  if (new.status = 'suspended' or old.status = 'suspended') and new.status is distinct from old.status
     and not public.has_role('admin') and current_setting('i12farm.safety', true) is distinct from 'on' then
    raise exception 'Only admins can suspend or restore a farm' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.report_farm(p_farm uuid, p_reason text, p_note text)
returns text   -- 'reported' | 'already' | 'hidden'
language plpgsql
security definer
set search_path = public
as $$
declare
  open_reporters integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to report a farm' using errcode = '42501';
  end if;
  if not exists (select 1 from public.farms f where f.id = p_farm and f.status = 'published') then
    raise exception 'No such farm' using errcode = 'P0002';
  end if;
  if public.can_manage_farm(p_farm) then
    raise exception 'You manage this farm' using errcode = '42501';
  end if;
  if (select count(*) from public.farm_reports r where r.reporter_id = auth.uid() and r.created_at > now() - interval '1 day') >= 10 then
    raise exception 'Too many reports today' using errcode = '54000';
  end if;
  insert into public.farm_reports (farm_id, reporter_id, reason, note)
  values (p_farm, auth.uid(), p_reason, nullif(trim(p_note), ''))
  on conflict (farm_id, reporter_id) where resolved_at is null do nothing;
  if not found then
    return 'already';
  end if;
  select count(distinct r.reporter_id) into open_reporters
    from public.farm_reports r where r.farm_id = p_farm and r.resolved_at is null;
  -- Verified farms (an agent has visited) are never hidden automatically.
  if open_reporters >= public.setting_int('report_hide_threshold', 3)
     and (select verified_at from public.farms where id = p_farm) is null then
    perform set_config('i12farm.safety', 'on', true);
    perform set_config('i12farm.status_note', 'Hidden after reports, waiting for review', true);
    update public.farms set status = 'suspended' where id = p_farm and status = 'published';
    perform set_config('i12farm.safety', '', true);
    return 'hidden';
  end if;
  return 'reported';
end;
$$;
revoke execute on function public.report_farm(uuid, text, text) from public, anon;
grant execute on function public.report_farm(uuid, text, text) to authenticated;

create or replace function public.admin_resolve_reports(p_farm uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  if p_action not in ('dismissed', 'suspended', 'restored') then
    raise exception 'Unknown action' using errcode = '22023';
  end if;
  if p_action = 'suspended' then
    update public.farms set status = 'suspended' where id = p_farm;
  elsif p_action = 'restored' or p_action = 'dismissed' then
    update public.farms set status = 'published' where id = p_farm and status = 'suspended'
       and exists (select 1 from public.farm_reports r where r.farm_id = p_farm and r.resolved_at is null);
  end if;
  update public.farm_reports r set resolved_at = now(), resolved_by = auth.uid(), resolution = p_action
   where r.farm_id = p_farm and r.resolved_at is null;
  insert into auth.audit_log (actor_id, action, details)
  values (auth.uid(), 'farm_reports.resolve', jsonb_build_object('farm', p_farm, 'action', p_action));
end;
$$;
revoke execute on function public.admin_resolve_reports(uuid, text) from public, anon;
grant execute on function public.admin_resolve_reports(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Safety: limits
-- ---------------------------------------------------------------------------
create or replace function public.farms_limit_new()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.has_role('agent') or public.has_role('admin') then
    return new;   -- seeds, agents and admins enrol many farms
  end if;
  if (select count(*) from public.farms f where f.created_by = auth.uid() and f.created_at > now() - interval '1 day')
       >= public.setting_int('new_farms_per_day', 3) then
    raise exception 'You can add % farms a day. Try again tomorrow.', public.setting_int('new_farms_per_day', 3) using errcode = '54000';
  end if;
  return new;
end;
$$;
create trigger farms_limit_new before insert on public.farms for each row execute function public.farms_limit_new();

-- Sign-ups per network: the server passes a one-way hash of the address.
create table auth.signup_networks (
  ip_hash text not null check (char_length(ip_hash) = 64),
  at      timestamptz not null default now()
);
create index signup_networks_idx on auth.signup_networks (ip_hash, at);

create or replace function public.signup_allowed(p_ip_hash text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from auth.signup_networks s where s.ip_hash = p_ip_hash and s.at > now() - interval '1 hour')
         < public.setting_int('signups_per_network_hour', 5);
$$;
revoke execute on function public.signup_allowed(text) from public, anon, authenticated;
