-- i12farm · Pesi payments: payout accounts, disbursements (payouts and refunds).
-- Runs after insight_test.sql (scripts/test-db.sh).

\set admin   '00000000-0000-4000-8000-0000000000ad'
\set farmer  '00000000-0000-4000-8000-0000000000f1'
\set buyer   '00000000-0000-4000-8000-0000000000b1'
\set agent   '00000000-0000-4000-8000-0000000000a1'
\set farm1   '10000000-0000-4000-8000-000000000001'

reset role;
select set_config('app.user_id', '', false);

do $$ begin
  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'payments' and column_name = 'provider') <> '''pesi''::text' then
    raise exception 'FAIL: new payments are not marked as Pesi';
  end if;
  if (select count(*) from public.pesi_banks) < 40 or (select name from public.pesi_banks where code = '68') <> 'EQUITY BANK LIMITED' then
    raise exception 'FAIL: Pesi bank list missing';
  end if;
  raise notice 'ok  payments default to Pesi; the bank list is loaded';
end $$;

-- Payout account: only the farm's managers (or an admin) can set it
do $$ begin
  perform public.set_farm_payout_account('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-000000000001',
                                         'M', '0712345678', null, null, null, 'X');
  raise exception 'FAIL: a buyer set a farm''s payout account';
exception when insufficient_privilege then
  raise notice 'ok  only farm managers set where the farm''s money goes';
end $$;
select channel, mobile from public.set_farm_payout_account(:'farmer', :'farm1', 'M', '0712 345 678', null, null, null, 'JANE WANJIKU DOE');
select public.set_farm_payout_account(:'farmer', :'farm1', 'B', null, '68', '0123456789', null, 'LAKEVIEW DAIRY');
do $$ begin
  if (select count(*) from public.farm_payout_account_history where farm_id = '10000000-0000-4000-8000-000000000001') < 2 then
    raise exception 'FAIL: payout account changes not kept';
  end if;
  if (select channel || bank_code from public.farm_payout_accounts where farm_id = '10000000-0000-4000-8000-000000000001') <> 'B68' then
    raise exception 'FAIL: payout account not updated';
  end if;
  raise notice 'ok  payout account saved, every change kept';
end $$;

set role authenticated;
select set_config('app.user_id', :'buyer', false);
do $$ begin
  if exists (select 1 from public.farm_payout_accounts) then
    raise exception 'FAIL: a buyer can read payout accounts';
  end if;
end $$;
select set_config('app.user_id', :'farmer', false);
do $$ begin
  if not exists (select 1 from public.farm_payout_accounts where farm_id = '10000000-0000-4000-8000-000000000001') then
    raise exception 'FAIL: the farmer can''t see their own payout account';
  end if;
  raise notice 'ok  payout accounts are private to the farm and admins';
end $$;

-- Payout batches
reset role;
select set_config('app.user_id', '', false);
insert into public.ledger_entries (farm_id, kind, amount_kes, reference)
values (:'farm1', 'payout_due', 1000, 'test');
select (coalesce(sum(amount_kes) filter (where kind = 'payout_due'), 0) - coalesce(sum(amount_kes) filter (where kind = 'payout_sent'), 0))::numeric as due0
  from public.ledger_entries where farm_id = :'farm1' \gset
select set_config('test.due0', :'due0', false);

set role authenticated;
select set_config('app.user_id', :'farmer', false);
do $$ begin
  perform public.admin_create_payout_batch(jsonb_build_array(jsonb_build_object(
    'kind', 'payout', 'farm_id', '10000000-0000-4000-8000-000000000001', 'amount', 10, 'channel', 'M', 'reference', 'I12D' || repeat('a', 24))));
  raise exception 'FAIL: a farmer prepared a payout batch';
exception when insufficient_privilege then
  raise notice 'ok  only admins prepare payout batches';
end $$;

select set_config('app.user_id', :'admin', false);
do $$
declare
  due numeric := current_setting('test.due0')::numeric;
  b public.payout_batches;
  c record;
begin
  select * into c from public.admin_payout_candidates() x where x.farm_id = '10000000-0000-4000-8000-000000000001' and x.kind = 'payout';
  if c.due_kes <> due or c.channel <> 'B' or c.bank_name <> 'EQUITY BANK LIMITED' or c.registered_name <> 'LAKEVIEW DAIRY' then
    raise exception 'FAIL: candidate list wrong: %', row_to_json(c);
  end if;
  b := public.admin_create_payout_batch(jsonb_build_array(jsonb_build_object(
    'kind', 'payout', 'farm_id', '10000000-0000-4000-8000-000000000001', 'amount', due - 100, 'channel', 'B',
    'receiver', '{"bankName":"EQUITY BANK LIMITED"}'::jsonb, 'validated_name', 'LAKEVIEW DAIRY', 'reference', 'I12D' || repeat('1', 24))), 'test batch');
  perform set_config('test.batch1', b.id::text, false);
  if (select due_kes from public.admin_payout_candidates() x where x.farm_id = '10000000-0000-4000-8000-000000000001' and x.kind = 'payout') <> 100 then
    raise exception 'FAIL: money in a draft batch still shown as due';
  end if;
  begin
    perform public.admin_create_payout_batch(jsonb_build_array(jsonb_build_object(
      'kind', 'payout', 'farm_id', '10000000-0000-4000-8000-000000000001', 'amount', 200, 'channel', 'B', 'reference', 'I12D' || repeat('2', 24))));
    raise exception 'FAIL: the same money put in two batches';
  exception when invalid_parameter_value then
    null;
  end;
  raise notice 'ok  a draft batch reserves the money; it can''t be batched twice';
end $$;

-- Nothing is sent before approval: a callback for a queued line is ignored
reset role;
select set_config('app.user_id', '', false);
do $$ begin
  if public.record_disbursement_result('I12D' || repeat('1', 24), 'completed', 'AC100', 'x', 't', '{}') <> 'unknown'
     or exists (select 1 from public.ledger_entries where kind = 'payout_sent' and reference = 'Pesi t') then
    raise exception 'FAIL: a line paid before its batch was approved';
  end if;
  raise notice 'ok  nothing counts as paid before the batch is approved';
end $$;

set role authenticated;
select set_config('app.user_id', :'admin', false);
select count(*) as sent from public.admin_approve_payout_batch(current_setting('test.batch1')::uuid) \gset
do $$ begin
  begin
    perform public.admin_approve_payout_batch(current_setting('test.batch1')::uuid);
    raise exception 'FAIL: batch approved twice';
  exception when object_not_in_prerequisite_state then
    null;
  end;
  if (select approved_by from public.payout_batches where id = current_setting('test.batch1')::uuid) <> '00000000-0000-4000-8000-0000000000ad' then
    raise exception 'FAIL: approver not recorded';
  end if;
  raise notice 'ok  approving a batch records who approved it; only once';
end $$;

reset role;
select set_config('app.user_id', '', false);
do $$
declare
  ref text := 'I12D' || repeat('1', 24);
  v text;
begin
  v := public.record_disbursement_result(ref, 'processing', '200', 'Transaction Processing', 'trace-1', '{}');
  if v <> 'processing' or exists (select 1 from public.ledger_entries where reference = 'Pesi trace-1') then
    raise exception 'FAIL: processing wrote to the ledger';
  end if;
  v := public.record_disbursement_result(ref, 'completed', 'AC100', 'Transaction Processed Successfully', 'trace-1', '{}');
  if v <> 'completed' or (select count(*) from public.ledger_entries where kind = 'payout_sent' and reference = 'Pesi trace-1') <> 1 then
    raise exception 'FAIL: completed payout not in the ledger (%)', v;
  end if;
  v := public.record_disbursement_result(ref, 'completed', 'AC100', 'again', 'trace-1', '{}');
  if v <> 'already_final' or (select count(*) from public.ledger_entries where reference = 'Pesi trace-1') <> 1 then
    raise exception 'FAIL: a repeated callback paid twice';
  end if;
  if (select status from public.payout_batches where id = current_setting('test.batch1')::uuid) <> 'done' then
    raise exception 'FAIL: batch not closed when all lines finished';
  end if;
  raise notice 'ok  a payout reaches the ledger once, only when Pesi says COMPLETED; the batch closes';
end $$;

-- A failed line frees the money; removing a line and cancelling a draft too
set role authenticated;
select set_config('app.user_id', :'admin', false);
select id as batch2 from public.admin_create_payout_batch(jsonb_build_array(jsonb_build_object(
  'kind', 'payout', 'farm_id', :'farm1', 'amount', 100, 'channel', 'M', 'reference', 'I12D' || repeat('3', 24)))) \gset
select count(*) from public.admin_approve_payout_batch(:'batch2');
reset role;
select set_config('app.user_id', '', false);
do $$ begin
  if public.record_disbursement_result('I12D' || repeat('3', 24), 'failed', 'AC300', 'Receiver Account Does Not Exist', null, '{}') <> 'failed' then
    raise exception 'FAIL: failed payout not recorded';
  end if;
  if public.record_disbursement_result('I12Dnope', 'completed', 'AC100', '', null, '{}') <> 'unknown' then
    raise exception 'FAIL: unknown reference accepted';
  end if;
end $$;
set role authenticated;
select set_config('app.user_id', :'admin', false);
do $$
declare b public.payout_batches; line uuid;
begin
  if (select due_kes from public.admin_payout_candidates() x where x.farm_id = '10000000-0000-4000-8000-000000000001' and x.kind = 'payout') <> 100 then
    raise exception 'FAIL: money of a failed payout not due again';
  end if;
  b := public.admin_create_payout_batch(jsonb_build_array(jsonb_build_object(
    'kind', 'payout', 'farm_id', '10000000-0000-4000-8000-000000000001', 'amount', 100, 'channel', 'M', 'reference', 'I12D' || repeat('4', 24))));
  select id into line from public.disbursements where batch_id = b.id;
  perform public.admin_remove_batch_line(line);
  begin
    perform public.admin_approve_payout_batch(b.id);
    raise exception 'FAIL: an empty batch was approved';
  exception when object_not_in_prerequisite_state then
    null;
  end;
  perform public.admin_cancel_payout_batch(b.id);
  if (select due_kes from public.admin_payout_candidates() x where x.farm_id = '10000000-0000-4000-8000-000000000001' and x.kind = 'payout') <> 100 then
    raise exception 'FAIL: cancelled batch still holds money';
  end if;
  raise notice 'ok  failed, removed and cancelled lines free the money for the next batch';
end $$;

-- What the farm sees
select set_config('app.user_id', :'farmer', false);
do $$ begin
  if (select count(*) from public.disbursements where farm_id = '10000000-0000-4000-8000-000000000001') < 3 then
    raise exception 'FAIL: farm can''t see its payouts';
  end if;
  if exists (select 1 from public.payout_batches) then
    raise exception 'FAIL: farm can see batches';
  end if;
end $$;
select set_config('app.user_id', :'buyer', false);
do $$ begin
  if exists (select 1 from public.disbursements) then
    raise exception 'FAIL: a buyer can see payouts';
  end if;
  raise notice 'ok  farms see their own payouts; buyers see none; batches are admin-only';
end $$;

reset role;
select set_config('app.user_id', '', false);
\echo 'All Pesi tests passed.'
