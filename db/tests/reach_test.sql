-- i12farm · Phase 3 tests: SMS outbox, USSD, vet requests, partner broadcasts.
-- Runs after phase2b_test.sql (scripts/test-db.sh).

\set agent   '00000000-0000-4000-8000-0000000000a1'
\set buyer   '00000000-0000-4000-8000-0000000000b1'
\set farmer  '00000000-0000-4000-8000-0000000000f1'
\set admin   '00000000-0000-4000-8000-0000000000ad'
\set partner '00000000-0000-4000-8000-0000000000c1'
\set farm1   '10000000-0000-4000-8000-000000000001'
\set vetfarm '10000000-0000-4000-8000-000000000008'

reset role;
select set_config('app.user_id', '', false);
-- Fixtures: the vet farm gets a public phone; a partner account.
update public.farms set phone_public = '0722000008' where id = :'vetfarm';
update public.farms set phone_public = '0722000002' where id = '10000000-0000-4000-8000-000000000002';
insert into auth.users (id, email, password_hash, meta)
values (:'partner', 'partner@dev.i12farm.local', 'x', '{"full_name":"County Extension Office"}') on conflict do nothing;
update public.profiles set roles = array['partner','buyer']::public.user_role[], organisation = 'Homa Bay Extension' where id = :'partner';
select id as milk from public.listings where farm_id = :'farm1' and product_slug = 'fresh-milk' \gset
select set_config('test.milk', :'milk', false);

-- ===========================================================================
-- Order alerts and USSD for farmers
-- ===========================================================================
set role authenticated;
select set_config('app.user_id', :'buyer', false);
select id as o1, number as o1n, subtotal_kes::integer as o1amt from public.place_order(jsonb_build_object('farm_id', :'farm1',
  'items', jsonb_build_array(jsonb_build_object('listing_id', current_setting('test.milk'), 'quantity', 2)),
  'buyer_phone', '0712 345 678')) \gset
select set_config('test.o1n', :'o1n', false);

reset role;
select set_config('app.user_id', '', false);
select public.record_payment_request(:'o1', '254712345678', :o1amt, 'm-r1', 'ws_CO_REACH_1', :'buyer');
select public.record_payment_result('ws_CO_REACH_1', 0, 'ok', 'TJKREACH01', :o1amt, '{}');

do $$ begin
  if not exists (select 1 from public.notifications where template = 'order_paid' and phone = '254700000002'
                 and params ->> 'number' = current_setting('test.o1n') and status = 'queued') then
    raise exception 'FAIL: no SMS to the farmer when the order was paid';
  end if;
  raise notice 'ok  paid order texts the farmer';
end $$;

do $$
declare c jsonb := public.ussd_context('0700000002');
begin
  if not exists (select 1 from jsonb_array_elements(c -> 'farms') f where f ->> 'name' = 'Lakeview Dairy') then
    raise exception 'FAIL: USSD does not find the farmer''s farm: %', c;
  end if;
  if jsonb_array_length(public.ussd_context('0799999999') -> 'farms') <> 0 then
    raise exception 'FAIL: a stranger''s phone sees farms';
  end if;
  if not exists (select 1 from public.ussd_open_orders('+254700000002') where number = current_setting('test.o1n')) then
    raise exception 'FAIL: open order missing on USSD';
  end if;
  raise notice 'ok  USSD matches farms by the caller''s phone';
end $$;

do $$ begin
  perform public.ussd_order_action('0799999999', current_setting('test.o1n'), 'accept');
  raise exception 'FAIL: another phone accepted the order';
exception when no_data_found then
  raise notice 'ok  other phones cannot touch the order';
end $$;

do $$ begin
  perform public.ussd_order_action('0700000002', current_setting('test.o1n'), 'ready');
  raise exception 'FAIL: skipped straight to ready';
exception when insufficient_privilege then
  raise notice 'ok  USSD follows the order rules';
end $$;

do $$ begin
  if public.ussd_order_action('0700000002', current_setting('test.o1n'), 'accept') <> 'accepted'
     or public.ussd_order_action('0700000002', current_setting('test.o1n'), 'ready') <> 'ready' then
    raise exception 'FAIL: USSD accept/ready';
  end if;
  if not exists (select 1 from public.order_status_history h join public.orders o on o.id = h.order_id
                  where o.number = current_setting('test.o1n') and h.to_status = 'ready'
                    and h.note = 'via USSD' and h.actor_id = '00000000-0000-4000-8000-0000000000f1') then
    raise exception 'FAIL: USSD change not recorded against the farmer';
  end if;
  if not exists (select 1 from public.notifications where template = 'order_ready' and phone = '254712345678') then
    raise exception 'FAIL: buyer not told the order is ready';
  end if;
  raise notice 'ok  farmer accepts and marks ready by USSD; buyer gets an SMS';
end $$;

do $$
declare lid uuid := current_setting('test.milk')::uuid;
begin
  perform public.ussd_update_listing('0700000002', lid, 65, null);
  perform public.ussd_update_listing('0700000002', lid, null, 0);
  if (select price_kes from public.listings where id = lid) <> 65 or (select status from public.listings where id = lid) <> 'sold_out' then
    raise exception 'FAIL: USSD price/stock update';
  end if;
  perform public.ussd_update_listing('0700000002', lid, null, 50);
  if (select status from public.listings where id = lid) <> 'active' then
    raise exception 'FAIL: restocking did not reactivate the listing';
  end if;
  begin
    perform public.ussd_update_listing('0799999999', lid, 1, null);
    raise exception 'FAIL: stranger changed a price';
  exception when no_data_found then null;
  end;
  raise notice 'ok  price and stock updates by USSD (own listings only)';
end $$;

-- ===========================================================================
-- The outbox is private
-- ===========================================================================
set role authenticated;
select set_config('app.user_id', :'buyer', false);
do $$ begin
  if exists (select 1 from public.notifications) then
    raise exception 'FAIL: a user can read the SMS outbox';
  end if;
  begin
    perform public.queue_sms('0712345678', 'broadcast', '{}', 'broadcast');
    raise exception 'FAIL: a user can queue SMS';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ussd_order_action('0700000002', 'AAAAAA', 'accept');
    raise exception 'FAIL: a user can call USSD functions';
  exception when insufficient_privilege then null;
  end;
  raise notice 'ok  outbox and USSD functions are server-only';
end $$;

-- ===========================================================================
-- Vet requests
-- ===========================================================================
select id as vr1, number as vr1n, vets_alerted from public.request_vet(jsonb_build_object(
  'county_code', 42, 'animal', 'pigs', 'place', 'Ahero market', 'description', 'Sow not eating since yesterday',
  'contact_phone', '0712345678')) \gset
select set_config('test.vr1', :'vr1', false);
\echo vets alerted: :vets_alerted

reset role;
select set_config('app.user_id', '', false);
do $$ begin
  if not exists (select 1 from public.notifications where template = 'vet_request' and phone = '254722000008'
                 and service_request_id = current_setting('test.vr1')::uuid) then
    raise exception 'FAIL: the county vet was not texted';
  end if;
  raise notice 'ok  vet request texts vets in the county';
end $$;

set role authenticated;
select set_config('app.user_id', :'agent', false);   -- the agent manages Maseno Vet Point
do $$ begin
  if (select contact_phone from public.vet_requests_for_me() where id = current_setting('test.vr1')::uuid) is not null then
    raise exception 'FAIL: vet sees the phone before accepting';
  end if;
  if not exists (select 1 from public.vet_requests_for_me() where id = current_setting('test.vr1')::uuid) then
    raise exception 'FAIL: vet does not see the open request';
  end if;
  raise notice 'ok  vets see open requests without the farmer''s number';
end $$;

select set_config('app.user_id', :'farmer', false);
do $$ begin
  perform public.accept_service_request(current_setting('test.vr1')::uuid, '10000000-0000-4000-8000-000000000001');
  raise exception 'FAIL: a non-vet farm took a vet request';
exception when insufficient_privilege then
  raise notice 'ok  only vet farms can take requests';
end $$;

select set_config('app.user_id', :'agent', false);
do $$ begin
  perform public.accept_service_request(current_setting('test.vr1')::uuid, '10000000-0000-4000-8000-000000000008');
  if (select contact_phone from public.vet_requests_for_me() where id = current_setting('test.vr1')::uuid) <> '254712345678' then
    raise exception 'FAIL: vet cannot see the number after accepting';
  end if;
  begin
    perform public.accept_service_request(current_setting('test.vr1')::uuid, '10000000-0000-4000-8000-000000000008');
    raise exception 'FAIL: accepted twice';
  exception when object_not_in_prerequisite_state then null;
  end;
  raise notice 'ok  vet accepts and gets the number; no double accept';
end $$;

select set_config('app.user_id', :'buyer', false);
do $$ begin
  if (select vet_phone from public.my_service_requests() where id = current_setting('test.vr1')::uuid) <> '254722000008' then
    raise exception 'FAIL: requester does not see the vet''s number';
  end if;
  perform public.close_service_request(current_setting('test.vr1')::uuid, 'completed');
  raise notice 'ok  requester sees the vet and can close the request';
end $$;

reset role;
select set_config('app.user_id', '', false);
do $$
declare r jsonb; t jsonb;
begin
  if not exists (select 1 from public.notifications where template = 'vet_accepted' and phone = '254712345678') then
    raise exception 'FAIL: requester not texted when the vet accepted';
  end if;
  r := public.ussd_request_vet('0733111222', 42::smallint, 'dairy', 'today');
  if not exists (select 1 from public.notifications where template = 'vet_request_received' and phone = '254733111222') then
    raise exception 'FAIL: no confirmation SMS for a USSD vet request';
  end if;
  if not exists (select 1 from public.ussd_vet_requests('0722000008') where number = r ->> 'number') then
    raise exception 'FAIL: vet does not see the request on USSD';
  end if;
  t := public.ussd_take_request('0722000008', r ->> 'number');
  if t ->> 'phone' <> '254733111222' then
    raise exception 'FAIL: USSD accept did not return the farmer''s number';
  end if;
  raise notice 'ok  vet requests and accepts work on USSD';

  r := public.ussd_request_vet('0733111222', 42::smallint, 'goats', 'this_week');
  update public.service_requests set created_at = now() - interval '3 days' where number = r ->> 'number';
  perform public.run_maintenance();
  if (select status from public.service_requests where number = r ->> 'number') <> 'expired' then
    raise exception 'FAIL: stale vet request did not expire';
  end if;
  raise notice 'ok  unanswered vet requests expire';
end $$;

-- ===========================================================================
-- Opt-outs and partner broadcasts
-- ===========================================================================
select public.set_phone_pref('0700000002', 'opt_out', 'sms');

set role authenticated;
select set_config('app.user_id', :'buyer', false);
do $$ begin
  perform public.create_broadcast('{"organisation":"Me","body_en":"Hello farmers everywhere","body_sw":"Habari wakulima wote"}');
  raise exception 'FAIL: a buyer created a broadcast';
exception when insufficient_privilege then
  raise notice 'ok  only partners can write broadcasts';
end $$;

select set_config('app.user_id', :'partner', false);
select public.create_broadcast(jsonb_build_object('organisation', 'Homa Bay Extension',
  'body_en', 'Free dairy vaccination at Imbo on Friday 9am.', 'body_sw', 'Chanjo ya bure ya ng''ombe Imbo Ijumaa saa tatu.',
  'counties', jsonb_build_array(43), 'categories', jsonb_build_array('dairy', 'poultry'))) as bid \gset
select set_config('test.bid', :'bid', false);
do $$ begin
  perform public.admin_review_broadcast(current_setting('test.bid')::uuid, true);
  raise exception 'FAIL: partner approved their own broadcast';
exception when insufficient_privilege then
  raise notice 'ok  partners cannot approve their own messages';
end $$;

select set_config('app.user_id', :'admin', false);
do $$
declare n integer;
begin
  n := public.admin_review_broadcast(current_setting('test.bid')::uuid, true, 'Looks good');
  if n <> 1 then
    raise exception 'FAIL: opted-out phone counted as a recipient (% recipients)', n;
  end if;
  if (public.broadcast_stats(current_setting('test.bid')::uuid) ->> 'skipped')::integer <> 1 then
    raise exception 'FAIL: opted-out phone not skipped';
  end if;
  raise notice 'ok  approved broadcast skips phones that sent STOP';
end $$;

reset role;
select set_config('app.user_id', '', false);
select public.set_phone_pref('0700000002', 'opt_in', 'sms');
do $$ begin
  if exists (select 1 from public.notifications where kind = 'transactional' and status = 'skipped') then
    raise exception 'FAIL: transactional SMS skipped';
  end if;
  if (select count(*) from public.phone_pref_events where phone = '254700000002') <> 2 then
    raise exception 'FAIL: opt-out history not kept';
  end if;
  raise notice 'ok  order SMS ignore opt-outs; opt-out history kept';
end $$;

\echo 'All phase 3 tests passed.'
