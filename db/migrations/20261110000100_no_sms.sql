-- i12farm · Remove SMS and USSD (decision of 10 Nov 2026)
-- The app no longer sends SMS or offers a USSD menu, and partner SMS
-- broadcasts go with them. Farmers and vets see new orders and vet requests
-- in the app (tab badges). Vet requests, accept/close and everything else
-- stay as they were. The Phase 3 migration is left untouched as history;
-- this one takes the pieces out.

-- Triggers that queued SMS
drop trigger if exists orders_notify on public.orders;
drop trigger if exists ledger_notify on public.ledger_entries;
drop trigger if exists service_requests_alert on public.service_requests;
drop function if exists public.orders_notify();
drop function if exists public.ledger_notify();
drop function if exists public.service_requests_alert();

-- USSD
drop function if exists public.ussd_take_request(text, text);
drop function if exists public.ussd_vet_requests(text);
drop function if exists public.ussd_request_vet(text, smallint, text, text);
drop function if exists public.ussd_update_listing(text, uuid, numeric, numeric);
drop function if exists public.ussd_listings(text);
drop function if exists public.ussd_order_action(text, text, text);
drop function if exists public.ussd_open_orders(text);
drop function if exists public.ussd_context(text);
drop function if exists public.ussd_farms(text);
drop function if exists public.ussd_user(text);

-- Partner SMS broadcasts
drop function if exists public.broadcast_stats(uuid);
drop function if exists public.admin_review_broadcast(uuid, boolean, text);
drop function if exists public.cancel_broadcast(uuid);
drop function if exists public.create_broadcast(jsonb);
drop function if exists public.broadcast_audience(smallint[], text[], boolean);
drop function if exists public.broadcast_phones(smallint[], text[], boolean);

-- The outbox and per-phone SMS preferences
drop function if exists public.queue_sms(text, text, jsonb, text, uuid, uuid, uuid);
drop function if exists public.set_phone_pref(text, text, text);
drop function if exists public.phone_locale(text);
drop table if exists public.notifications;
drop table if exists public.broadcasts;
drop table if exists public.phone_pref_events;
drop table if exists public.phone_prefs;

delete from public.platform_settings
 where key in ('sms_daily_cap', 'sms_cost_kes', 'ussd_code', 'broadcast_max_recipients', 'vet_alert_max', 'paid_reminder_hours');

-- ---------------------------------------------------------------------------
-- Vet requests without SMS: vets_alerted now counts the vet services in the
-- county that see the request in their app.
-- ---------------------------------------------------------------------------
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
  if (select count(*) from public.service_requests s where s.contact_phone = ph and s.status = 'open') >= 3
     or (p_requester is not null
         and (select count(*) from public.service_requests s where s.requester_id = p_requester and s.status = 'open') >= 3) then
    raise exception 'You already have 3 open requests' using errcode = '54000';
  end if;
  perform set_config('i12farm.via', p_via, true);
  insert into public.service_requests (requester_id, contact_phone, contact_name, county_code, place, animal, description, urgency, via, vets_alerted)
  values (p_requester, ph, nullif(trim(p_name), ''), p_county, nullif(trim(p_place), ''), p_animal,
          nullif(trim(p_description), ''), coalesce(p_urgency, 'today'), p_via,
          (select count(*)::integer from public.farms f
            where f.status = 'published' and 'vet-services' = any (f.categories) and f.county_code = p_county))
  returning * into row;
  return row;
end;
$$;
revoke execute on function public.create_service_request(uuid, text, text, smallint, text, text, text, text, text) from public, anon, authenticated;

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
  return r;
end;
$$;
revoke execute on function public.take_service_request(uuid, uuid, text) from public, anon, authenticated;

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
  return outcome;
end;
$$;
revoke execute on function public.close_service_request(uuid, text) from public, anon;
grant execute on function public.close_service_request(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Upkeep without SMS: unanswered paid orders are still declined (refund due);
-- the farm sees them waiting on its Orders badge until then.
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
  drop_h   integer := public.setting_int('paid_decline_hours', 36);
  r        record;
  done     integer := 0;
  dropped  integer := 0;
  expired  integer := 0;
  ended    integer := 0;
  vets     integer := 0;
  declined integer := 0;
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

  return jsonb_build_object('auto_completed', done, 'unpaid_cancelled', dropped, 'unanswered_declined', declined,
                            'payments_expired', expired, 'promotions_ended', ended,
                            'vet_requests_expired', vets, 'ran_at', now());
end;
$$;
revoke execute on function public.run_maintenance() from public, anon, authenticated;
