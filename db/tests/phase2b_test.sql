-- i12farm · Phase 2b tests: bookings, maintenance, featured listings.
-- Runs after trade_test.sql (scripts/test-db.sh).

\set agent  '00000000-0000-4000-8000-0000000000a1'
\set buyer  '00000000-0000-4000-8000-0000000000b1'
\set farmer '00000000-0000-4000-8000-0000000000f1'
\set farm1  '10000000-0000-4000-8000-000000000001'
\set farm2  '10000000-0000-4000-8000-000000000002'

reset role;
select set_config('app.user_id', '', false);
select id as training from public.listings where farm_id = :'farm1' and product_slug = 'farm-training' \gset
select id as milk from public.listings where farm_id = :'farm1' and product_slug = 'fresh-milk' \gset
select id as hens from public.listings where farm_id = :'farm2' and product_slug = 'kienyeji-chicken' \gset
select set_config('test.training', :'training', false);
select set_config('test.milk', :'milk', false);

-- ===========================================================================
-- Bookings
-- ===========================================================================
set role authenticated;
select set_config('app.user_id', :'buyer', false);

do $$ begin
  perform 1 from public.place_order(jsonb_build_object('farm_id', '10000000-0000-4000-8000-000000000001',
    'items', jsonb_build_array(jsonb_build_object('listing_id', current_setting('test.training'), 'quantity', 2)),
    'buyer_phone', '0712345678'));
  raise exception 'FAIL: booking without a visit date accepted';
exception when invalid_parameter_value then
  raise notice 'ok  bookings need a visit date';
end $$;

do $$ begin
  perform 1 from public.place_order(jsonb_build_object('farm_id', '10000000-0000-4000-8000-000000000001',
    'items', jsonb_build_array(jsonb_build_object('listing_id', current_setting('test.training'), 'quantity', 2)),
    'buyer_phone', '0712345678', 'visit_date', (now() at time zone 'Africa/Nairobi')::date::text));
  raise exception 'FAIL: same-day booking accepted';
exception when invalid_parameter_value then
  raise notice 'ok  bookings start from tomorrow';
end $$;

select id as booking from public.place_order(jsonb_build_object('farm_id', :'farm1',
  'items', jsonb_build_array(jsonb_build_object('listing_id', :'training', 'quantity', 2)),
  'buyer_phone', '0712345678', 'visit_date', ((now() at time zone 'Africa/Nairobi')::date + 7)::text, 'visit_slot', 'afternoon')) \gset
select set_config('test.booking', :'booking', false);

do $$
declare o public.orders;
begin
  select * into o from public.orders where id = current_setting('test.booking')::uuid;
  if o.visit_date is null or o.visit_slot <> 'afternoon' or o.subtotal_kes <> 1000 then
    raise exception 'FAIL: booking fields wrong: % % %', o.visit_date, o.visit_slot, o.subtotal_kes;
  end if;
  raise notice 'ok  training is booked for a date and slot through the order flow';
end $$;

select id as goods from public.place_order(jsonb_build_object('farm_id', :'farm1',
  'items', jsonb_build_array(jsonb_build_object('listing_id', :'milk', 'quantity', 3)),
  'buyer_phone', '0712345678', 'visit_date', '2030-01-01')) \gset
select set_config('test.goods', :'goods', false);
do $$ begin
  if (select visit_date from public.orders where id = current_setting('test.goods')::uuid) is not null then
    raise exception 'FAIL: goods order kept a visit date';
  end if;
  raise notice 'ok  goods orders carry no visit date';
end $$;

-- ===========================================================================
-- Maintenance
-- ===========================================================================
do $$ begin
  perform public.run_maintenance();
  raise exception 'FAIL: users can run maintenance';
exception when insufficient_privilege then
  raise notice 'ok  maintenance is server-only';
end $$;

reset role;
select set_config('app.user_id', '', false);

-- The booking is paid, accepted, made ready and then left for 4 days.
select public.record_payment_request(:'booking', '254712345678', 1000, 'm', 'ws_CO_2B_1', :'buyer');
select public.record_payment_result('ws_CO_2B_1', 0, 'ok', 'TJK2BOOK01', 1000, '{}');
set role authenticated;
select set_config('app.user_id', :'farmer', false);
select public.set_order_status(:'booking', 'accepted');
select public.set_order_status(:'booking', 'ready');
reset role;
select set_config('app.user_id', '', false);
update public.order_status_history set at = now() - interval '4 days' where order_id = :'booking' and to_status = 'ready';
-- The goods order was never paid and is 3 days old; a prompt is pending on another.
update public.orders set created_at = now() - interval '3 days' where id = :'goods';
insert into public.payments (order_id, phone, amount_kes, checkout_request_id, requested_at)
values (:'goods', '254712345678', 180, 'ws_CO_2B_STALE', now() - interval '2 hours');

do $$
declare r jsonb;
begin
  r := public.run_maintenance();
  if (r ->> 'auto_completed')::int < 1 then raise exception 'FAIL: ready order not auto-completed: %', r; end if;
  if (select status from public.orders where id = current_setting('test.booking')::uuid) <> 'completed' then
    raise exception 'FAIL: booking not completed';
  end if;
  if not exists (select 1 from public.ledger_entries where order_id = current_setting('test.booking')::uuid and kind = 'payout_due') then
    raise exception 'FAIL: auto-completion did not make the payout due';
  end if;
  if (select actor_id from public.order_status_history where order_id = current_setting('test.booking')::uuid and to_status = 'completed') is not null then
    raise exception 'FAIL: auto-completion should be recorded as the system';
  end if;
  if (select status from public.orders where id = current_setting('test.goods')::uuid) <> 'cancelled' then
    raise exception 'FAIL: unpaid order not cancelled';
  end if;
  if (select status from public.payments where checkout_request_id = 'ws_CO_2B_STALE') <> 'expired' then
    raise exception 'FAIL: stale prompt not expired';
  end if;
  raise notice 'ok  maintenance completes old ready orders, cancels unpaid ones, expires silent prompts';
end $$;

do $$
declare r text;
begin
  -- M-Pesa answers late with a success for the expired prompt: counted, refunded (order already cancelled).
  r := public.record_payment_result('ws_CO_2B_STALE', 0, 'late', 'TJK2LATE01', 180, '{}');
  if r <> 'paid_after_cancel' then raise exception 'FAIL: late success after expiry gave %', r; end if;
  if (select status from public.payments where checkout_request_id = 'ws_CO_2B_STALE') <> 'succeeded' then
    raise exception 'FAIL: late success not recorded';
  end if;
  raise notice 'ok  a late M-Pesa success after expiry is still recorded (and refunded)';
end $$;

do $$
declare r jsonb;
begin
  r := public.run_maintenance();
  if (r ->> 'auto_completed')::int <> 0 or (r ->> 'unpaid_cancelled')::int <> 0 then
    raise exception 'FAIL: maintenance is not idempotent: %', r;
  end if;
  raise notice 'ok  maintenance is safe to run again';
end $$;

-- ===========================================================================
-- Featured listings
-- ===========================================================================
set role authenticated;
select set_config('app.user_id', :'buyer', false);
do $$ begin
  perform 1 from public.request_promotion('10000000-0000-4000-8000-000000000002', 7);
  raise exception 'FAIL: a buyer promoted someone else''s farm';
exception when insufficient_privilege then
  raise notice 'ok  only farm managers buy featured listings';
end $$;

select set_config('app.user_id', :'agent', false);
do $$ begin
  perform 1 from public.request_promotion('10000000-0000-4000-8000-000000000002', 5);
  raise exception 'FAIL: unknown plan accepted';
exception when invalid_parameter_value then
  raise notice 'ok  plans and prices come from settings';
end $$;
select id as promo, amount_kes as promo_price from public.request_promotion(:'farm2', 7) \gset

do $$ begin
  if public.farm_featured('10000000-0000-4000-8000-000000000002') then
    raise exception 'FAIL: featured before payment';
  end if;
  raise notice 'ok  unpaid promotions do nothing';
end $$;

reset role;
select set_config('app.user_id', '', false);
select public.record_promotion_payment_request(:'promo', '254712345678', :promo_price, 'm', 'ws_CO_PROMO_1', :'agent');
select public.record_payment_result('ws_CO_PROMO_1', 0, 'ok', 'TJKPROMO01', :promo_price, '{}');

set role anon;
select set_config('app.user_id', '', false);
do $$
declare first_id uuid;
begin
  select id into first_id from public.farms_in_bbox(34.0, -1.0, 35.2, 0.2) limit 1;
  if first_id <> '10000000-0000-4000-8000-000000000002' then
    raise exception 'FAIL: featured farm not first on the map (got %)', first_id;
  end if;
  if not (select featured from public.farms_in_bbox(34.0, -1.0, 35.2, 0.2) where id = '10000000-0000-4000-8000-000000000002') then
    raise exception 'FAIL: featured flag missing';
  end if;
  raise notice 'ok  paid featured farms come first on the map';
end $$;

do $$ begin
  perform 1 from public.farm_promotions;
  raise exception 'FAIL: visitors can read promotions';
exception when insufficient_privilege then
  raise notice 'ok  promotion records are private';
end $$;

reset role;
select set_config('app.user_id', '', false);
do $$ begin
  if not exists (select 1 from public.ledger_entries where kind = 'promotion_fee' and reference = 'TJKPROMO01') then
    raise exception 'FAIL: promotion fee not in the ledger';
  end if;
  update public.farm_promotions set starts_at = now() - interval '8 days', ends_at = now() - interval '1 day'
   where farm_id = '10000000-0000-4000-8000-000000000002';
  perform public.run_maintenance();
  if public.farm_featured('10000000-0000-4000-8000-000000000002') then
    raise exception 'FAIL: promotion still running after it ended';
  end if;
  raise notice 'ok  featured listings end on time and the fee is in the ledger';
end $$;

\echo 'All phase 2b tests passed.'
