-- i12farm · vet request tests (Phase 3, without SMS since 10 Nov 2026).
-- Runs after phase2b_test.sql (scripts/test-db.sh).

\set agent   '00000000-0000-4000-8000-0000000000a1'
\set buyer   '00000000-0000-4000-8000-0000000000b1'
\set farmer  '00000000-0000-4000-8000-0000000000f1'
\set vetfarm '10000000-0000-4000-8000-000000000008'

reset role;
select set_config('app.user_id', '', false);
update public.farms set phone_public = '0722000008' where id = :'vetfarm';

set role authenticated;
select set_config('app.user_id', :'buyer', false);
select id as vr1, number as vr1n, vets_alerted from public.request_vet(jsonb_build_object(
  'county_code', 42, 'animal', 'pigs', 'place', 'Ahero market', 'description', 'Sow not eating since yesterday',
  'contact_phone', '0712345678')) \gset
select set_config('test.vr1', :'vr1', false);
\echo vets alerted: :vets_alerted

do $$ begin
  if (select vets_alerted from public.service_requests where id = current_setting('test.vr1')::uuid) < 1 then
    raise exception 'FAIL: no vets counted for the county';
  end if;
  raise notice 'ok  vet request counts the vets in the county who will see it';
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
declare rid uuid;
begin
  rid := (public.create_service_request(null, '0733111222', null, 42::smallint, null, 'goats', null, 'this_week', 'web')).id;
  update public.service_requests set created_at = now() - interval '3 days' where id = rid;
  perform public.run_maintenance();
  if (select status from public.service_requests where id = rid) <> 'expired' then
    raise exception 'FAIL: stale vet request did not expire';
  end if;
  raise notice 'ok  unanswered vet requests expire';
end $$;

do $$ begin
  if to_regclass('public.notifications') is not null or to_regprocedure('public.queue_sms(text,text,jsonb,text,uuid,uuid,uuid)') is not null
     or exists (select 1 from pg_proc where proname like 'ussd\_%') then
    raise exception 'FAIL: SMS or USSD objects still in the database';
  end if;
  raise notice 'ok  no SMS or USSD left in the database';
end $$;

\echo 'All vet request tests passed.'
