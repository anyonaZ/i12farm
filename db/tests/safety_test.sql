-- i12farm · Phase 6 tests: push notifications outbox, reports, limits.
-- Runs after pesi_test.sql (scripts/test-db.sh).

\set admin   '00000000-0000-4000-8000-0000000000ad'
\set farmer  '00000000-0000-4000-8000-0000000000f1'
\set buyer   '00000000-0000-4000-8000-0000000000b1'
\set agent   '00000000-0000-4000-8000-0000000000a1'
\set partner '00000000-0000-4000-8000-0000000000c1'
\set farm1   '10000000-0000-4000-8000-000000000001'

reset role;
select set_config('app.user_id', '', false);
delete from public.push_outbox;

-- Subscriptions
set role authenticated;
select set_config('app.user_id', :'farmer', false);
select public.save_push_subscription('https://push.example/farmer-1', repeat('p', 87), repeat('a', 22), 'test');
select set_config('app.user_id', :'buyer', false);
select public.save_push_subscription('https://push.example/buyer-1', repeat('p', 87), repeat('a', 22), 'test');
do $$ begin
  if (select count(*) from public.push_subscriptions) <> 1 then
    raise exception 'FAIL: people can see other people''s devices';
  end if;
  raise notice 'ok  each person sees only their own devices';
end $$;
-- The same phone, a different person signed in: the device moves to them.
select set_config('app.user_id', :'partner', false);
select public.save_push_subscription('https://push.example/buyer-1', repeat('p', 87), repeat('a', 22), 'shared phone');
reset role;
do $$ begin
  if (select user_id from public.push_subscriptions where endpoint = 'https://push.example/buyer-1') <> '00000000-0000-4000-8000-0000000000c1' then
    raise exception 'FAIL: shared phone kept the old person';
  end if;
  update public.push_subscriptions set user_id = '00000000-0000-4000-8000-0000000000b1' where endpoint = 'https://push.example/buyer-1';
  raise notice 'ok  a shared phone notifies whoever signed in on it last';
end $$;

-- A paid order notifies the farm; the farm's answer notifies the buyer.
select id as milk from public.listings where farm_id = :'farm1' and product_slug = 'fresh-milk' \gset
set role authenticated;
select set_config('app.user_id', :'buyer', false);
select id as o1, subtotal_kes::integer as amt from public.place_order(jsonb_build_object('farm_id', :'farm1',
  'items', jsonb_build_array(jsonb_build_object('listing_id', :'milk', 'quantity', 1)), 'buyer_phone', '0712345678')) \gset
reset role;
select set_config('app.user_id', '', false);
select public.record_payment_request(:'o1', '254712345678', :amt, 'pesi', 'I12P' || repeat('7', 24), :'buyer');
select public.record_payment_result('I12P' || repeat('7', 24), 0, 'ok', 'TRACEPUSH', :amt, '{}');
select set_config('test.o1', :'o1', false);
do $$ begin
  if not exists (select 1 from public.push_outbox where user_id = '00000000-0000-4000-8000-0000000000f1' and template = 'orderPaid') then
    raise exception 'FAIL: farm not told about a paid order';
  end if;
  if exists (select 1 from public.push_outbox where user_id = '00000000-0000-4000-8000-0000000000a1') then
    raise exception 'FAIL: someone without notifications got a row';
  end if;
  perform public.apply_order_status(current_setting('test.o1')::uuid, 'accepted', 't', null);
  if not exists (select 1 from public.push_outbox where user_id = '00000000-0000-4000-8000-0000000000b1' and template = 'orderAccepted') then
    raise exception 'FAIL: buyer not told the order was accepted';
  end if;
  raise notice 'ok  paid orders notify the farm; answers notify the buyer; only people with notifications on';
end $$;

-- Preferences
set role authenticated;
select set_config('app.user_id', :'buyer', false);
select public.set_push_prefs('{"orders": false}');
reset role;
select set_config('app.user_id', '', false);
do $$ begin
  perform public.apply_order_status(current_setting('test.o1')::uuid, 'ready', 't', null);
  if exists (select 1 from public.push_outbox where user_id = '00000000-0000-4000-8000-0000000000b1' and template = 'orderReady') then
    raise exception 'FAIL: order notification sent with orders turned off';
  end if;
  raise notice 'ok  a topic turned off sends nothing';
end $$;
update public.profiles set push_prefs = '{"orders": true, "messages": true, "vets": true, "payouts": true}' where id = :'buyer';

-- Messages: one waiting notification per conversation
insert into public.conversations (farm_id, buyer_id) values (:'farm1', :'buyer') on conflict do nothing;
select id as conv from public.conversations where farm_id = :'farm1' and buyer_id = :'buyer' \gset
set role authenticated;
select set_config('app.user_id', :'buyer', false);
insert into public.messages (conversation_id, body) values (:'conv', 'Do you have milk today?');
insert into public.messages (conversation_id, body) values (:'conv', 'And eggs?');
reset role;
select set_config('app.user_id', '', false);
do $$ begin
  if (select count(*) from public.push_outbox where user_id = '00000000-0000-4000-8000-0000000000f1' and template = 'messageToFarm' and sent_at is null) <> 1 then
    raise exception 'FAIL: message notifications not grouped per conversation';
  end if;
  raise notice 'ok  messages notify the other side, one waiting notification per conversation';
end $$;

-- The sender's queue: claim returns the text parameters and the devices
do $$
declare r record;
begin
  select * into r from public.claim_push_batch(10) where template = 'orderPaid';
  if r.subscriptions -> 0 ->> 'endpoint' <> 'https://push.example/farmer-1' or r.locale is null then
    raise exception 'FAIL: claim_push_batch shape';
  end if;
  raise notice 'ok  the sender gets text parameters, language and devices';
end $$;

-- Reports
select id as rfarm from public.farms where status = 'published' and verified_at is null
   and coalesce(owner_id, managed_by) not in (:'buyer', :'partner', :'admin') limit 1 \gset
select id as vfarm from public.farms where status = 'published' and verified_at is not null
   and coalesce(owner_id, managed_by) not in (:'buyer', :'partner', :'admin') limit 1 \gset
select set_config('test.rfarm', :'rfarm', false);
select set_config('test.vfarm', :'vfarm', false);
set role authenticated;
select set_config('app.user_id', :'farmer', false);
do $$ begin
  perform public.report_farm('10000000-0000-4000-8000-000000000001', 'fake', 'mine');
  raise exception 'FAIL: reported own farm';
exception when insufficient_privilege then
  raise notice 'ok  you can''t report your own farm';
end $$;
select set_config('app.user_id', :'buyer', false);
select public.report_farm(:'rfarm', 'scam', 'Asked me to pay to his number');
select public.report_farm(:'vfarm', 'scam', null);
do $$ begin
  if public.report_farm(current_setting('test.rfarm')::uuid, 'fake', null) <> 'already' then
    raise exception 'FAIL: one person reported twice';
  end if;
end $$;
select set_config('app.user_id', :'partner', false);
select public.report_farm(:'rfarm', 'fake', null);
select public.report_farm(:'vfarm', 'fake', null);
reset role;
insert into auth.users (id, phone, password_hash, meta)
values ('00000000-0000-4000-8000-0000000000d8', '254799000888', 'x', '{"full_name":"Third Reporter"}') on conflict do nothing;
set role authenticated;
select set_config('app.user_id', '00000000-0000-4000-8000-0000000000d8', false);
do $$ begin
  if public.report_farm(current_setting('test.rfarm')::uuid, 'fake', null) <> 'hidden' then
    raise exception 'FAIL: farm not hidden after 3 reports';
  end if;
  if public.report_farm(current_setting('test.vfarm')::uuid, 'fake', null) = 'hidden' then
    raise exception 'FAIL: a verified farm was hidden automatically';
  end if;
  raise notice 'ok  3 different people hide an unverified farm until review; verified farms stay';
end $$;
set role anon;
select set_config('app.user_id', '', false);
do $$ begin
  if exists (select 1 from public.farms where id = current_setting('test.rfarm')::uuid) then
    raise exception 'FAIL: hidden farm still public';
  end if;
  if exists (select 1 from public.farm_reports) then
    raise exception 'FAIL: visitors can read reports';
  end if;
  raise notice 'ok  reports are admin-only; the hidden farm is off the map';
end $$;
set role authenticated;
select set_config('app.user_id', :'admin', false);
select public.admin_resolve_reports(:'rfarm', 'restored');
do $$ begin
  if (select status from public.farms where id = current_setting('test.rfarm')::uuid) <> 'published'
     or exists (select 1 from public.farm_reports where farm_id = current_setting('test.rfarm')::uuid and resolved_at is null) then
    raise exception 'FAIL: restore';
  end if;
  raise notice 'ok  an admin restores the farm and closes its reports';
end $$;

-- Limits
select set_config('app.user_id', :'farmer', false);
do $$
declare i integer; prior integer;
begin
  select count(*) into prior from public.farms where created_by = '00000000-0000-4000-8000-0000000000f1' and created_at > now() - interval '1 day';
  for i in 1..(3 - prior) loop
    insert into public.farms (owner_id, name, categories, county_code, status, created_by)
    values ('00000000-0000-4000-8000-0000000000f1', 'Limit test ' || i, '{poultry}', 43, 'draft', '00000000-0000-4000-8000-0000000000f1');
  end loop;
  begin
    insert into public.farms (owner_id, name, categories, county_code, status, created_by)
    values ('00000000-0000-4000-8000-0000000000f1', 'Limit test 4', '{poultry}', 43, 'draft', '00000000-0000-4000-8000-0000000000f1');
    raise exception 'FAIL: a fourth farm in one day';
  exception when program_limit_exceeded then
    null;
  end;
  raise notice 'ok  3 new farms a day per account (agents and admins excepted)';
end $$;
reset role;
select set_config('app.user_id', '', false);
do $$
declare i integer;
begin
  for i in 1..5 loop insert into auth.signup_networks (ip_hash) values (repeat('c', 64)); end loop;
  if public.signup_allowed(repeat('c', 64)) or not public.signup_allowed(repeat('d', 64)) then
    raise exception 'FAIL: sign-up limit per network';
  end if;
  raise notice 'ok  5 new accounts an hour per network';
end $$;

-- The 6-hour nudge
select public.save_push_subscription('https://push.example/farmer-1', repeat('p', 87), repeat('a', 22), 'test')
  from (select set_config('app.user_id', '00000000-0000-4000-8000-0000000000f1', false)) x;
set role authenticated;
select set_config('app.user_id', :'buyer', false);
select id as o2, subtotal_kes::integer as amt2 from public.place_order(jsonb_build_object('farm_id', :'farm1',
  'items', jsonb_build_array(jsonb_build_object('listing_id', :'milk', 'quantity', 1)), 'buyer_phone', '0712345678')) \gset
reset role;
select set_config('app.user_id', '', false);
select public.record_payment_request(:'o2', '254712345678', :amt2, 'pesi', 'I12P' || repeat('8', 24), :'buyer');
select public.record_payment_result('I12P' || repeat('8', 24), 0, 'ok', 'TRACEPUSH2', :amt2, '{}');
select set_config('test.o2', :'o2', false);
do $$
declare oid uuid := current_setting('test.o2')::uuid;
begin
  update public.orders set paid_at = now() - interval '7 hours', farm_reminded_at = null where id = oid;
  delete from public.push_outbox;
  perform public.run_maintenance();
  if not exists (select 1 from public.push_outbox where template = 'orderWaiting') or (select farm_reminded_at from public.orders where id = oid) is null then
    raise exception 'FAIL: unanswered order not nudged';
  end if;
  raise notice 'ok  the farm is nudged once about a paid order waiting 6 hours';
end $$;

delete from public.push_outbox;
delete from public.push_subscriptions;
\echo 'All safety tests passed.'
