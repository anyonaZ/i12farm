-- i12farm · Phase 3.5 tests: unanswered paid orders, search, account deletion, badges.
-- Runs after reach_test.sql (scripts/test-db.sh).

\set buyer   '00000000-0000-4000-8000-0000000000b1'
\set farmer  '00000000-0000-4000-8000-0000000000f1'
\set farm1   '10000000-0000-4000-8000-000000000001'

reset role;
select set_config('app.user_id', '', false);
select id as milk from public.listings where farm_id = :'farm1' and product_slug = 'fresh-milk' \gset

-- A paid order the farm ignores
set role authenticated;
select set_config('app.user_id', :'farmer', false);
select (public.nav_counts() ->> 'orders') as before_orders \gset
select set_config('test.before', :'before_orders', false);
select set_config('app.user_id', :'buyer', false);
select id as o1, number as o1n, subtotal_kes::integer as amt from public.place_order(jsonb_build_object('farm_id', :'farm1',
  'items', jsonb_build_array(jsonb_build_object('listing_id', :'milk', 'quantity', 1)), 'buyer_phone', '0712345678')) \gset
select set_config('test.o1', :'o1', false);


reset role;
select set_config('app.user_id', '', false);
select public.record_payment_request(:'o1', '254712345678', :amt, 'm-h1', 'ws_CO_HARD_1', :'buyer');
select public.record_payment_result('ws_CO_HARD_1', 0, 'ok', 'TJKHARD001', :amt, '{}');

set role authenticated;
select set_config('app.user_id', :'farmer', false);
do $$ begin
  if (public.nav_counts() ->> 'orders')::integer <> current_setting('test.before')::integer + 1 then
    raise exception 'FAIL: farmer badge does not count exactly the new paid order';
  end if;
  raise notice 'ok  farmer badge counts paid orders, not unpaid ones';
end $$;

select set_config('app.user_id', :'buyer', false);
do $$ begin
  perform public.delete_my_account();
  raise exception 'FAIL: account deleted with an open order';
exception when object_not_in_prerequisite_state then
  raise notice 'ok  accounts with open orders cannot be deleted';
end $$;

reset role;
select set_config('app.user_id', '', false);
do $$
declare
  oid uuid := current_setting('test.o1')::uuid;
  r jsonb;
begin
  update public.orders set paid_at = now() - interval '7 hours' where id = oid;
  r := public.run_maintenance();
  if (r ->> 'unanswered_reminded')::integer < 1
     or not exists (select 1 from public.notifications where template = 'order_reminder' and order_id = oid) then
    raise exception 'FAIL: no reminder to the farm: %', r;
  end if;
  r := public.run_maintenance();
  if (select count(*) from public.notifications where template = 'order_reminder' and order_id = oid) <> 1 then
    raise exception 'FAIL: farm reminded twice';
  end if;
  raise notice 'ok  unanswered paid order: one reminder SMS to the farm';

  update public.orders set paid_at = now() - interval '37 hours' where id = oid;
  r := public.run_maintenance();
  if (select status from public.orders where id = oid) <> 'declined' then
    raise exception 'FAIL: unanswered order not declined';
  end if;
  if not exists (select 1 from public.ledger_entries where order_id = oid and kind = 'refund_due') then
    raise exception 'FAIL: no refund due after automatic decline';
  end if;
  if not exists (select 1 from public.notifications where template = 'order_declined' and order_id = oid) then
    raise exception 'FAIL: buyer not told about the automatic decline';
  end if;
  raise notice 'ok  unanswered paid order declined after 36 h, refund due, buyer texted';
end $$;

-- Search
set role anon;
select set_config('app.user_id', '', false);
do $$ begin
  if not exists (select 1 from public.search_farms('lake-view') where name = 'Lakeview Dairy') then
    raise exception 'FAIL: search trips over punctuation (lake-view)';
  end if;
  if not exists (select 1 from public.search_farms('mayai')) then
    raise exception 'FAIL: Kiswahili everyday word (mayai) finds nothing';
  end if;
  if not exists (select 1 from public.search_farms('chiken')) then
    raise exception 'FAIL: small typo finds nothing';
  end if;
  if exists (select 1 from public.search_farms('zzzzqq')) then
    raise exception 'FAIL: nonsense matched';
  end if;
  raise notice 'ok  search forgives punctuation and typos, knows everyday words';
end $$;

-- Delete my account
do $$ begin
  perform public.delete_my_account();
  raise exception 'FAIL: visitors can call delete_my_account';
exception when insufficient_privilege then
  raise notice 'ok  delete is for signed-in people only';
end $$;

reset role;
insert into auth.users (id, phone, email, password_hash, meta)
values ('00000000-0000-4000-8000-0000000000d9', '254799000999', 'leaving@example.com', 'x', '{"full_name":"Leaving Person"}');
insert into public.saved_farms (user_id, farm_id) values ('00000000-0000-4000-8000-0000000000d9', :'farm1');
set role authenticated;
select set_config('app.user_id', '00000000-0000-4000-8000-0000000000d9', false);
select public.delete_my_account();

reset role;
select set_config('app.user_id', '', false);
do $$ begin
  if exists (select 1 from auth.users where id = '00000000-0000-4000-8000-0000000000d9'
               and (email is not null or phone is not null or password_hash is not null or status <> 'deleted')) then
    raise exception 'FAIL: sign-in details kept after deletion';
  end if;
  if (select full_name from public.profiles where id = '00000000-0000-4000-8000-0000000000d9') is not null then
    raise exception 'FAIL: name kept after deletion';
  end if;
  if exists (select 1 from public.saved_farms where user_id = '00000000-0000-4000-8000-0000000000d9') then
    raise exception 'FAIL: saved farms kept';
  end if;
  -- the phone number can sign up again
  insert into auth.users (phone, password_hash) values ('254799000999', 'x');
  raise notice 'ok  deleting an account removes personal and sign-in details; the number is free again';
end $$;

-- Farm links
reset role;
do $$
declare a text; b text;
begin
  insert into public.farms (managed_by, name, categories, county_code, status)
  values ('00000000-0000-4000-8000-0000000000a1', 'Tumaini Shamba', '{poultry}', 43, 'draft') returning slug into a;
  insert into public.farms (managed_by, name, categories, county_code, status)
  values ('00000000-0000-4000-8000-0000000000a1', 'Tumaini Shamba', '{poultry}', 43, 'draft') returning slug into b;
  if a <> 'tumaini-shamba' or b !~ '^tumaini-shamba-[0-9a-f]{5}$' then
    raise exception 'FAIL: farm links %, %', a, b;
  end if;
  raise notice 'ok  farm links are clean; an ending is added only when the name is taken';
end $$;

\echo 'All hardening tests passed.'
