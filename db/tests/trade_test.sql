-- i12farm · Phase 2 trade, accounts and messaging tests
-- Runs after security_test.sql on the same database (scripts/test-db.sh).
-- Each block raises 'FAIL: …' on a broken rule.

\set farmer '00000000-0000-4000-8000-0000000000f1'
\set agent  '00000000-0000-4000-8000-0000000000a1'
\set buyer  '00000000-0000-4000-8000-0000000000b1'
\set admin  '00000000-0000-4000-8000-0000000000ad'
\set farm1  '10000000-0000-4000-8000-000000000001'
\set farm2  '10000000-0000-4000-8000-000000000002'
\set farm3  '10000000-0000-4000-8000-000000000003'

reset role;
select set_config('app.user_id', '', false);
select id as eggs, quantity::int as eggs_before from public.listings
 where farm_id = :'farm2' and product_slug = 'eggs' \gset
select id as hens from public.listings where farm_id = :'farm2' and product_slug = 'kienyeji-chicken' \gset
select id as milk from public.listings where farm_id = :'farm1' and product_slug = 'fresh-milk' \gset

-- ===========================================================================
-- Buyer places an order
-- ===========================================================================
set role authenticated;
select set_config('app.user_id', :'buyer', false);

select id as order1, number as order1_no from public.place_order(jsonb_build_object(
  'farm_id', :'farm2',
  'items', jsonb_build_array(
    jsonb_build_object('listing_id', :'eggs', 'quantity', 2),
    jsonb_build_object('listing_id', :'hens', 'quantity', 1)),
  'fulfilment', 'pickup', 'buyer_name', 'Dev Buyer', 'buyer_phone', '0712 345 678',
  'price_kes', 1)) \gset

select set_config('test.order1', :'order1', false);
select set_config('test.eggs', :'eggs', false);

do $$
declare o public.orders;
begin
  select * into o from public.orders where id = current_setting('test.order1')::uuid;
  if o.subtotal_kes <> 2 * 450 + 900 then raise exception 'FAIL: order total should come from listings (1800), got %', o.subtotal_kes; end if;
  if o.commission_kes <> 180 or o.farmer_payout_kes <> 1620 then
    raise exception 'FAIL: commission 10%% expected 180/1620, got %/%', o.commission_kes, o.farmer_payout_kes;
  end if;
  if o.buyer_phone <> '254712345678' then raise exception 'FAIL: phone not normalised: %', o.buyer_phone; end if;
  if o.status <> 'awaiting_payment' then raise exception 'FAIL: new order status %', o.status; end if;
  if (select count(*) from public.order_items where order_id = o.id) <> 2 then raise exception 'FAIL: order items missing'; end if;
  if (select count(*) from public.order_status_history where order_id = o.id) <> 1 then raise exception 'FAIL: history row for placement missing'; end if;
  raise notice 'ok  orders are priced from live listings with commission snapshotted';
end $$;

do $$ begin
  update public.orders set subtotal_kes = 1 where id = current_setting('test.order1')::uuid;
  raise exception 'FAIL: buyer edited an order directly';
exception when insufficient_privilege then
  raise notice 'ok  orders cannot be edited directly';
end $$;

do $$ begin
  perform public.set_order_status(current_setting('test.order1')::uuid, 'paid');
  raise exception 'FAIL: buyer marked their own order paid';
exception when insufficient_privilege then
  raise notice 'ok  only M-Pesa results mark orders paid';
end $$;

do $$ begin
  perform public.record_payment_result('x', 0, 'ok', 'ABC', 1800, '{}');
  raise exception 'FAIL: a user can call record_payment_result';
exception when insufficient_privilege then
  raise notice 'ok  payment results are server-only';
end $$;

do $$ begin
  perform 1 from public.place_order(jsonb_build_object('farm_id', '10000000-0000-4000-8000-000000000002',
    'items', jsonb_build_array(jsonb_build_object('listing_id', current_setting('test.eggs'), 'quantity', 100000)),
    'buyer_phone', '0712345678'));
  raise exception 'FAIL: ordered more than in stock';
exception when invalid_parameter_value then
  raise notice 'ok  orders cannot exceed listed stock';
end $$;

-- ===========================================================================
-- Farmer cannot buy from their own farm; strangers cannot see the order
-- ===========================================================================
select set_config('app.user_id', :'farmer', false);
select set_config('test.milk', :'milk', false);

do $$ begin
  perform 1 from public.place_order(jsonb_build_object('farm_id', '10000000-0000-4000-8000-000000000001',
    'items', jsonb_build_array(jsonb_build_object('listing_id', current_setting('test.milk'), 'quantity', 2)),
    'buyer_phone', '0712345678'));
  raise exception 'FAIL: farmer ordered from own farm';
exception when insufficient_privilege then
  raise notice 'ok  farmers cannot order from their own farm';
end $$;

do $$ begin
  if exists (select 1 from public.orders where id = current_setting('test.order1')::uuid) then
    raise exception 'FAIL: unrelated user can see an order';
  end if;
  if exists (select 1 from public.order_items where order_id = current_setting('test.order1')::uuid) then
    raise exception 'FAIL: unrelated user can see order items';
  end if;
  raise notice 'ok  orders are private to buyer, farm and admins';
end $$;

-- ===========================================================================
-- M-Pesa result (server, as the owner role)
-- ===========================================================================
reset role;
select set_config('app.user_id', '', false);
select public.record_payment_request(:'order1', '254712345678', 1800, 'm-1', 'ws_CO_TEST_1', :'buyer');

do $$
declare r text;
begin
  r := public.record_payment_result('ws_CO_TEST_1', 0, 'The service request is processed successfully.', 'TJK1ABC2DE', 1800, '{"test":true}');
  if r <> 'paid' then raise exception 'FAIL: payment result %', r; end if;
  r := public.record_payment_result('ws_CO_TEST_1', 0, 'again', 'TJK1ABC2DE', 1800, '{}');
  if r <> 'already_final' then raise exception 'FAIL: repeated callback should be a no-op, got %', r; end if;
  if (select status from public.orders where id = current_setting('test.order1')::uuid) <> 'paid' then
    raise exception 'FAIL: order not paid';
  end if;
  if (select count(*) from public.ledger_entries where order_id = current_setting('test.order1')::uuid) <> 3 then
    raise exception 'FAIL: expected buyer_payment, commission, farmer_payable';
  end if;
  if (select sum(amount_kes) filter (where kind = 'commission') + sum(amount_kes) filter (where kind = 'farmer_payable')
        from public.ledger_entries where order_id = current_setting('test.order1')::uuid) <> 1800 then
    raise exception 'FAIL: ledger does not add up to the payment';
  end if;
  raise notice 'ok  M-Pesa success marks paid once and writes the ledger';
end $$;

do $$ begin
  if (select quantity from public.listings where id = current_setting('test.eggs')::uuid) <> 38 then
    raise exception 'FAIL: stock not reduced after payment (expected 38), got %',
      (select quantity from public.listings where id = current_setting('test.eggs')::uuid);
  end if;
  if (select count(*) from public.price_history where listing_id = current_setting('test.eggs')::uuid) < 2 then
    raise exception 'FAIL: stock change not in price_history';
  end if;
  raise notice 'ok  paid quantities come off the listing and are recorded';
end $$;

-- ===========================================================================
-- Farm side (the field agent manages farm 2)
-- ===========================================================================
set role authenticated;
select set_config('app.user_id', :'agent', false);

do $$ begin
  if not exists (select 1 from public.orders where id = current_setting('test.order1')::uuid) then
    raise exception 'FAIL: farm manager cannot see the order';
  end if;
  perform public.set_order_status(current_setting('test.order1')::uuid, 'accepted', 'Collect after 4 pm');
  perform public.set_order_status(current_setting('test.order1')::uuid, 'ready');
  raise notice 'ok  farm managers accept and mark orders ready';
end $$;

do $$ begin
  perform public.set_order_status(current_setting('test.order1')::uuid, 'completed');
  raise exception 'FAIL: farm completed the order for the buyer';
exception when insufficient_privilege then
  raise notice 'ok  only the buyer confirms receipt';
end $$;

do $$
declare b record;
begin
  select * into b from public.farm_balance('10000000-0000-4000-8000-000000000002');
  if b.pending_kes <> 1620 or b.due_kes <> 0 then raise exception 'FAIL: balance before completion %/%', b.pending_kes, b.due_kes; end if;
  raise notice 'ok  farmer sees the held amount before completion';
end $$;

-- ===========================================================================
-- Buyer confirms, reviews; ratings show on the map
-- ===========================================================================
select set_config('app.user_id', :'buyer', false);

do $$ begin
  perform public.leave_review(current_setting('test.order1')::uuid, 5, 'Fresh eggs');
  raise exception 'FAIL: review before completion';
exception when insufficient_privilege then
  raise notice 'ok  reviews open only after completion';
end $$;

do $$ begin
  perform public.set_order_status(current_setting('test.order1')::uuid, 'completed');
  perform public.leave_review(current_setting('test.order1')::uuid, 5, 'Fresh eggs, friendly farmer');
  if (select review_count from public.farms_in_bbox(34.0, -1.0, 34.8, -0.3) where id = '10000000-0000-4000-8000-000000000002') <> 1 then
    raise exception 'FAIL: rating not on the map card';
  end if;
  if (select author_name from public.reviews where order_id = current_setting('test.order1')::uuid) <> 'Dev B.' then
    raise exception 'FAIL: public review name should be "Dev B.", got %', (select author_name from public.reviews where order_id = current_setting('test.order1')::uuid);
  end if;
  raise notice 'ok  buyer confirms receipt and leaves one review';
end $$;

do $$ begin
  perform public.leave_review(current_setting('test.order1')::uuid, 1, 'again');
  raise exception 'FAIL: second review on one order';
exception when unique_violation then
  raise notice 'ok  one review per order';
end $$;

-- ===========================================================================
-- Ledger after completion
-- ===========================================================================
select set_config('app.user_id', :'agent', false);
do $$
declare b record;
begin
  select * into b from public.farm_balance('10000000-0000-4000-8000-000000000002');
  if b.pending_kes <> 0 or b.due_kes <> 1620 then raise exception 'FAIL: balance after completion %/%', b.pending_kes, b.due_kes; end if;
  raise notice 'ok  completion makes the farmer''s share due';
end $$;

select set_config('app.user_id', :'farmer', false);
do $$ begin
  if exists (select 1 from public.farm_balance('10000000-0000-4000-8000-000000000002')) then
    raise exception 'FAIL: another farmer can read this farm''s balance';
  end if;
  if exists (select 1 from public.ledger_entries where farm_id = '10000000-0000-4000-8000-000000000002') then
    raise exception 'FAIL: another farmer can read this farm''s ledger';
  end if;
  raise notice 'ok  balances and ledger are private to the farm';
end $$;

-- ===========================================================================
-- Cancel unpaid; late payment after cancel becomes a refund
-- ===========================================================================
select set_config('app.user_id', :'buyer', false);
select id as order2 from public.place_order(jsonb_build_object(
  'farm_id', :'farm2', 'items', jsonb_build_array(jsonb_build_object('listing_id', :'eggs', 'quantity', 1)),
  'buyer_phone', '254712345678')) \gset
select public.set_order_status(:'order2', 'cancelled', 'Changed my mind');
reset role;
select set_config('app.user_id', '', false);
select public.record_payment_request(:'order2', '254712345678', 450, 'm-2', 'ws_CO_TEST_2', :'buyer');
select set_config('test.order2', :'order2', false);
do $$
declare r text;
begin
  r := public.record_payment_result('ws_CO_TEST_2', 0, 'ok', 'TJK9LATE01', 450, '{}');
  if r <> 'paid_after_cancel' then raise exception 'FAIL: late payment result %', r; end if;
  if (select sum(amount_kes) from public.ledger_entries where order_id = current_setting('test.order2')::uuid and kind = 'refund_due') <> 450 then
    raise exception 'FAIL: refund not recorded for late payment';
  end if;
  if (select status from public.orders where id = current_setting('test.order2')::uuid) <> 'cancelled' then
    raise exception 'FAIL: cancelled order changed status on late payment';
  end if;
  raise notice 'ok  a payment after cancelling is recorded as a refund due';
end $$;

do $$
declare r text;
begin
  insert into public.payments (order_id, phone, amount_kes, checkout_request_id)
  values (current_setting('test.order2')::uuid, '254712345678', 450, 'ws_CO_TEST_3');
  r := public.record_payment_result('ws_CO_TEST_3', 1032, 'Request cancelled by user', null, null, '{}');
  if r <> 'failed' or (select status from public.payments where checkout_request_id = 'ws_CO_TEST_3') <> 'cancelled' then
    raise exception 'FAIL: user-cancelled STK not recorded as cancelled';
  end if;
  raise notice 'ok  cancelled STK prompts are recorded';
end $$;

-- ===========================================================================
-- Messaging
-- ===========================================================================
set role authenticated;
select set_config('app.user_id', :'buyer', false);
select public.open_conversation(:'farm3') as conv \gset
select set_config('test.conv', :'conv', false);
insert into public.messages (conversation_id, body) values (:'conv', 'Do you have honey this week?');

do $$ begin
  insert into public.messages (conversation_id, body, kind) values (current_setting('test.conv')::uuid, 'paid', 'order');
  raise exception 'FAIL: user wrote a system order message';
exception when insufficient_privilege or with_check_option_violation then
  raise notice 'ok  users send text only; order notes come from the system';
end $$;

select set_config('app.user_id', :'agent', false);
do $$ begin
  if (select count(*) from public.messages where conversation_id = current_setting('test.conv')::uuid) <> 1 then
    raise exception 'FAIL: farm manager cannot read the buyer''s message';
  end if;
  insert into public.messages (conversation_id, body) values (current_setting('test.conv')::uuid, 'Yes, 30 kg');
  if (select unread from public.my_conversations() where id = current_setting('test.conv')::uuid) <> 1 then
    raise exception 'FAIL: unread count for the farm should be 1';
  end if;
  raise notice 'ok  buyer and farm talk in one thread';
end $$;

select set_config('app.user_id', :'farmer', false);
do $$ begin
  if exists (select 1 from public.messages where conversation_id = current_setting('test.conv')::uuid) then
    raise exception 'FAIL: outsider read a conversation';
  end if;
  insert into public.messages (conversation_id, body) values (current_setting('test.conv')::uuid, 'spam');
  raise exception 'FAIL: outsider posted into a conversation';
exception when insufficient_privilege or with_check_option_violation then
  raise notice 'ok  conversations are private to the buyer and the farm';
end $$;

select set_config('app.user_id', :'buyer', false);
do $$ begin
  if not exists (select 1 from public.my_conversations() where farm_id = '10000000-0000-4000-8000-000000000002' and last_kind = 'order') then
    raise exception 'FAIL: order updates missing from the buyer''s inbox';
  end if;
  raise notice 'ok  order status changes appear in the conversation';
end $$;

-- ===========================================================================
-- Claim codes
-- ===========================================================================
select set_config('app.user_id', :'agent', false);
select code as claim_code from public.issue_claim_code(:'farm3') \gset

select set_config('app.user_id', :'buyer', false);
select set_config('test.claim', :'claim_code', false);
do $$
declare n integer;
begin
  select count(*) into n from public.claim_farm('00000000');
  if n <> 0 then raise exception 'FAIL: wrong claim code accepted'; end if;
  select count(*) into n from public.claim_farm(substr(current_setting('test.claim'), 1, 4) || ' ' || substr(current_setting('test.claim'), 5));
  if n <> 1 then raise exception 'FAIL: correct claim code refused'; end if;
  if (select owner_id from public.farms where id = '10000000-0000-4000-8000-000000000003') <> auth.uid() then
    raise exception 'FAIL: claimant is not the owner';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and 'farmer' = any (roles)) then
    raise exception 'FAIL: claimant did not get the farmer role';
  end if;
  select count(*) into n from public.claim_farm(current_setting('test.claim'));
  if n <> 0 then raise exception 'FAIL: claim code worked twice'; end if;
  raise notice 'ok  farmers claim agent-enrolled farms with a one-time code';
end $$;

do $$ begin
  perform 1 from public.farm_claim_codes;
  raise exception 'FAIL: users can read claim codes';
exception when insufficient_privilege then
  raise notice 'ok  claim codes are not readable';
end $$;

-- ===========================================================================
-- Admin functions
-- ===========================================================================
do $$ begin
  perform 1 from public.admin_list_users();
  raise exception 'FAIL: non-admin listed users';
exception when insufficient_privilege then
  raise notice 'ok  only admins list users';
end $$;

select set_config('app.user_id', :'admin', false);
do $$ begin
  perform public.admin_set_roles('00000000-0000-4000-8000-0000000000b1', array['buyer','agent']::public.user_role[]);
  if not exists (select 1 from public.admin_list_users('buyer@dev') where 'agent' = any (roles)) then
    raise exception 'FAIL: role change not visible';
  end if;
  begin
    perform public.admin_set_roles(auth.uid(), array['buyer']::public.user_role[]);
    raise exception 'FAIL: admin removed own admin role';
  exception when insufficient_privilege then null;
  end;
  perform public.admin_record_payout('10000000-0000-4000-8000-000000000002', 1620, 'TJK2PAYOUT1');
  if (select due_kes from public.farm_balance('10000000-0000-4000-8000-000000000002')) <> 0 then
    raise exception 'FAIL: payout not deducted';
  end if;
  begin
    perform public.admin_record_payout('10000000-0000-4000-8000-000000000002', 1, 'X');
    raise exception 'FAIL: paid out more than due';
  exception when invalid_parameter_value then null;
  end;
  perform public.admin_set_user_status('00000000-0000-4000-8000-0000000000b1', 'suspended', 'test');
  perform public.admin_set_user_status('00000000-0000-4000-8000-0000000000b1', 'active', 'test');
  raise notice 'ok  admins manage roles, status and payouts (and cannot lock themselves out)';
end $$;

reset role;
select set_config('app.user_id', '', false);
do $$ begin
  if (select count(*) from auth.audit_log) < 3 then
    raise exception 'FAIL: admin actions not audited';
  end if;
  raise notice 'ok  admin actions are written to the audit log';
end $$;

\echo 'All trade tests passed.'
