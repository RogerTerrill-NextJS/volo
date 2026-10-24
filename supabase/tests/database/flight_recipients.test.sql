begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_function('public','change_flight_recipient',array['uuid','uuid','boolean'],'Guarded recipient boundary exists');
select has_function('public','create_private_flight',array['text','text','timestamp with time zone','text','text','integer','text','uuid[]'],'Atomic private creation exists');
insert into auth.users(id,email) select ('17900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'recipient-'||n||'@example.invalid' from generate_series(1,5) n;
insert into public.memberships(user_id,role,status,disabled_at,disabled_reason)
select ('17900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 case when n=2 then 'admin' else 'member' end::public.member_role,
 case when n=4 then 'disabled' else 'active' end::public.membership_status,
 case when n=4 then now() end,case when n=4 then 'Owned fixture' end
from generate_series(1,4) n;
insert into public.profiles(user_id,display_name,home_airport,pilot_designation) values('17900000-0000-4000-8000-000000000001','Owner','KPAO','licensed');
create function pg_temp.make_private(ids uuid[]) returns uuid language sql as $$
 select public.create_private_flight('KPAO','KSQL',clock_timestamp()+interval '2 days','UTC','C172',2,'',ids);
$$;
create function pg_temp.change_recipient(target uuid,chosen boolean) returns uuid language sql as $$
 select public.change_flight_recipient('17910000-0000-4000-8000-000000000001',target,chosen);
$$;
insert into public.flights(id,owner_id,departure_airport,destination_airport,departure_at,departure_timezone,aircraft_description,pilot_places,visibility) values
 ('17910000-0000-4000-8000-000000000001','17900000-0000-4000-8000-000000000001','KPAO','KSQL',now()+interval '2 days','UTC','C172',2,'PRIVATE'),
 ('17910000-0000-4000-8000-000000000002','17900000-0000-4000-8000-000000000001','KPAO','KSQL',now()+interval '2 days','UTC','C172',2,'NETWORK');
set local role anon;
select throws_ok($$select pg_temp.change_recipient('17900000-0000-4000-8000-000000000003',true)$$,'42501',null,'Anonymous cannot change recipients');
select throws_ok($$select pg_temp.make_private(array['17900000-0000-4000-8000-000000000003']::uuid[])$$,'42501',null,'Anonymous cannot create private selection');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"17900000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select pg_temp.change_recipient('17900000-0000-4000-8000-000000000003',true)$$,'42501',null,'Unrelated admin has no owner bypass');
select set_config('request.jwt.claims','{"sub":"17900000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select pg_temp.change_recipient('17900000-0000-4000-8000-000000000003',true)$$,'Owner adds active recipient without a new profile gate');
select lives_ok($$select pg_temp.change_recipient('17900000-0000-4000-8000-000000000003',true)$$,'Duplicate add is idempotent');
select is((select count(*)::integer from public.flight_recipients where flight_id='17910000-0000-4000-8000-000000000001'),1,'Duplicate add creates one selection');
select throws_ok($$select pg_temp.change_recipient('17900000-0000-4000-8000-000000000001',true)$$,'22023',null,'Owner cannot select themselves');
select throws_ok($$select pg_temp.change_recipient('17900000-0000-4000-8000-000000000004',true)$$,'22023',null,'Disabled recipient rejected');
select throws_ok($$select pg_temp.change_recipient('17900000-0000-4000-8000-000000000005',true)$$,'22023',null,'Auth-only recipient rejected');
select throws_ok($$select public.change_flight_recipient('17910000-0000-4000-8000-000000000002','17900000-0000-4000-8000-000000000003',true)$$,'22023',null,'NETWORK cannot receive selections');
select throws_ok($$select pg_temp.change_recipient(null,true)$$,'22023',null,'Null recipient rejected');
select throws_ok($$select pg_temp.change_recipient('17900000-0000-4000-8000-000000000003',null)$$,'22023',null,'Null operation rejected');
select throws_ok($$insert into public.flight_recipients values('17910000-0000-4000-8000-000000000001','17900000-0000-4000-8000-000000000002',now())$$,'42501',null,'Direct insertion stays closed');
select throws_ok($$delete from public.flight_recipients where flight_id='17910000-0000-4000-8000-000000000001'$$,'42501',null,'Direct deletion stays closed');
select throws_ok($$select flight_private.validate_recipient_ids(auth.uid(),array['17900000-0000-4000-8000-000000000003']::uuid[])$$,'42501',null,'Private helper is not an authenticated RPC');
select throws_ok($$select pg_temp.make_private('{}'::uuid[])$$,'22023',null,'Atomic selection requires nonempty array');
select throws_ok($$select pg_temp.make_private(null)$$,'22023',null,'Null array rejected');
select throws_ok($$select pg_temp.make_private(array[null]::uuid[])$$,'22023',null,'Null array element rejected');
select throws_ok($$select pg_temp.make_private(array[['17900000-0000-4000-8000-000000000002'],['17900000-0000-4000-8000-000000000003']]::uuid[])$$,'22023',null,'Multidimensional selection rejected');
select throws_ok($$select pg_temp.make_private(array(select ('17920000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,500) n))$$,'22023',null,'Oversized direct RPC selection rejected');
select throws_ok($$select pg_temp.make_private(array['17900000-0000-4000-8000-000000000001']::uuid[])$$,'22023',null,'Atomic creation cannot select its owner');
select throws_ok($$select pg_temp.make_private(array['17900000-0000-4000-8000-000000000003','17900000-0000-4000-8000-000000000003']::uuid[])$$,'22023',null,'Duplicate selections rejected');
select throws_ok($$select pg_temp.make_private(array['17900000-0000-4000-8000-000000000003','17900000-0000-4000-8000-000000000004']::uuid[])$$,'22023',null,'Mixed active/disabled batch rejected atomically');
select is((select count(*)::integer from public.flights where owner_id=auth.uid()),2,'Rejected batches leave no partial flight');
select lives_ok($$select pg_temp.make_private(array['17900000-0000-4000-8000-000000000002','17900000-0000-4000-8000-000000000003']::uuid[])$$,'Valid batch creates private flight and selected audience');
select is((select count(*)::integer from public.flight_recipients),3,'Two atomic recipients plus prior selection');
select set_config('request.jwt.claims','{"sub":"17900000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is((select count(*)::integer from public.flights where id='17910000-0000-4000-8000-000000000001'),1,'Selected recipient can read private flight');
select throws_ok($$select pg_temp.change_recipient('17900000-0000-4000-8000-000000000002',true)$$,'42501',null,'Recipient cannot widen audience');
select set_config('request.jwt.claims','{"sub":"17900000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select pg_temp.change_recipient('17900000-0000-4000-8000-000000000003',false)$$,'No-request removal succeeds');
select lives_ok($$select pg_temp.change_recipient('17900000-0000-4000-8000-000000000003',false)$$,'Removal retry is idempotent');
select set_config('request.jwt.claims','{"sub":"17900000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is((select count(*)::integer from public.flights where id='17910000-0000-4000-8000-000000000001'),0,'Retained JWT loses private access after removal');
select set_config('request.jwt.claims','{"sub":"17900000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select pg_temp.change_recipient('17900000-0000-4000-8000-000000000003',true)$$,'Owner can re-add without changing any request lifecycle');
reset role;
-- Conversation persistence is integrated; no-request removal still needs no thread.
set local role authenticated;
select lives_ok($$select pg_temp.change_recipient('17900000-0000-4000-8000-000000000003',false)$$,'Conversation schema permits integrated no-request removal');
select is((select count(*)::integer from public.flight_recipients where flight_id='17910000-0000-4000-8000-000000000001'),0,'Removal removes selection without creating history');
reset role;
update public.memberships set status='disabled',disabled_at=now(),disabled_reason='Owned revoke' where user_id='17900000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.change_recipient('17900000-0000-4000-8000-000000000003',false)$$,'42501',null,'Disabled owner retained JWT cannot change audience');
reset role;
select * from finish();
rollback;
