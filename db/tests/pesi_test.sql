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

-- Disbursements
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
  perform public.admin_start_disbursement('payout', '10000000-0000-4000-8000-000000000001', null, 10, 'M', '{}', null,
                                          'I12D' || repeat('a', 24));
  raise exception 'FAIL: a farmer started a payout';
exception when insufficient_privilege then
  raise notice 'ok  only admins start payouts';
end $$;

select set_config('app.user_id', :'admin', false);
do $$
declare
  due numeric := current_setting('test.due0')::numeric;
begin
  perform public.admin_start_disbursement('payout', '10000000-0000-4000-8000-000000000001', null, due - 100, 'B',
                                          '{"bankName":"EQUITY BANK LIMITED"}', 'LAKEVIEW DAIRY', 'I12D' || repeat('1', 24));
  begin
    perform public.admin_start_disbursement('payout', '10000000-0000-4000-8000-000000000001', null, 200, 'B',
                                            '{}', null, 'I12D' || repeat('2', 24));
    raise exception 'FAIL: paid more than is due while a payout is on its way';
  exception when invalid_parameter_value then
    null;
  end;
  begin
    perform public.admin_start_disbursement('payout', '10000000-0000-4000-8000-000000000001', null, 50, 'B',
                                            '{}', null, 'I12D' || repeat('1', 24));
    raise exception 'FAIL: the same reference was accepted twice';
  exception when unique_violation then
    null;
  end;
  raise notice 'ok  money on its way is reserved; references are unique';
end $$;

reset role;
select set_config('app.user_id', '', false);
do $$
declare
  ref text := 'I12D' || repeat('1', 24);
  v text;
  due numeric := current_setting('test.due0')::numeric;
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
  if (select coalesce(sum(amount_kes) filter (where kind = 'payout_due'), 0) - coalesce(sum(amount_kes) filter (where kind = 'payout_sent'), 0)
        from public.ledger_entries where farm_id = '10000000-0000-4000-8000-000000000001') <> 100 then
    raise exception 'FAIL: amount still due is wrong';
  end if;
  raise notice 'ok  a payout reaches the ledger once, only when Pesi says COMPLETED';
end $$;

set role authenticated;
select set_config('app.user_id', :'admin', false);
select public.admin_start_disbursement('payout', :'farm1', null, 100, 'M', '{}', null, 'I12D' || repeat('3', 24));
reset role;
select set_config('app.user_id', '', false);
do $$
declare v text;
begin
  v := public.record_disbursement_result('I12D' || repeat('3', 24), 'failed', 'AC300', 'Receiver Account Does Not Exist', null, '{}');
  if v <> 'failed' or exists (select 1 from public.ledger_entries where kind = 'payout_sent' and amount_kes = 100
                                and farm_id = '10000000-0000-4000-8000-000000000001' and reference like 'Pesi I12D3%') then
    raise exception 'FAIL: failed payout handled wrongly';
  end if;
  if public.record_disbursement_result('I12Dnope', 'completed', 'AC100', '', null, '{}') <> 'unknown' then
    raise exception 'FAIL: unknown reference accepted';
  end if;
  raise notice 'ok  a failed payout frees the money to try again; unknown references are ignored';
end $$;

set role authenticated;
select set_config('app.user_id', :'admin', false);
select public.admin_start_disbursement('payout', :'farm1', null, 100, 'M', '{}', null, 'I12D' || repeat('4', 24));

-- What the farm sees
select set_config('app.user_id', :'farmer', false);
do $$ begin
  if (select count(*) from public.disbursements where farm_id = '10000000-0000-4000-8000-000000000001') < 3 then
    raise exception 'FAIL: farm can''t see its payouts';
  end if;
end $$;
select set_config('app.user_id', :'buyer', false);
do $$ begin
  if exists (select 1 from public.disbursements) then
    raise exception 'FAIL: a buyer can see payouts';
  end if;
  raise notice 'ok  farms see their own payouts; buyers see none';
end $$;

reset role;
select set_config('app.user_id', '', false);
\echo 'All Pesi tests passed.'
