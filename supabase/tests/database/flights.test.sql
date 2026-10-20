begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
select has_table('public', 'flights', 'Flight persistence exists');
select has_table('public', 'flight_recipients', 'Private audience persistence exists');

-- Owned fictional subjects; no reliance on seed data or real accounts.
insert into auth.users (id, email)
select ('17300000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  'flight-' || n || '@example.invalid' from generate_series(1,7) n;
insert into public.memberships (user_id, role, status, disabled_at, disabled_reason)
select ('17300000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  case when n=4 then 'admin' else 'member' end::public.member_role,
  case when n=5 then 'disabled' else 'active' end::public.membership_status,
  case when n=5 then now() end, case when n=5 then 'Owned test' end
from generate_series(1,7) n where n<>6;

-- This helper only supplies a baseline; overrides include explicit NULL values.
create function pg_temp.insert_flight(overrides jsonb default '{}') returns uuid
language plpgsql as $$
declare f public.flights; result uuid;
begin
  f := jsonb_populate_record(null::public.flights, '{
    "owner_id":"17300000-0000-4000-8000-000000000001",
    "departure_airport":"KPAO","destination_airport":"KPAO",
    "departure_at":"2026-11-01T06:30:00Z","departure_timezone":"America/Los_Angeles",
    "departure_local_date":"2000-01-01","aircraft_description":"Cessna 172",
    "pilot_places":2,"visibility":"NETWORK","status":"open"}'::jsonb || overrides);
  insert into public.flights (owner_id,departure_airport,destination_airport,departure_at,
    departure_timezone,departure_local_date,aircraft_description,pilot_places,notes,visibility,status)
  values (f.owner_id,f.departure_airport,f.destination_airport,f.departure_at,
    f.departure_timezone,f.departure_local_date,f.aircraft_description,f.pilot_places,f.notes,f.visibility,f.status)
  returning id into result;
  return result;
end;
$$;

select lives_ok($$select pg_temp.insert_flight()$$, 'Same-airport local flight accepted');
select is((select departure_local_date from public.flights limit 1), date '2026-10-31', 'Local date derived across UTC midnight, ignoring supplied date');
select lives_ok($$select pg_temp.insert_flight(jsonb_build_object('aircraft_description',repeat('A',500),'notes',repeat('N',2000)))$$, 'Approved text boundaries accepted');
select throws_ok($$select pg_temp.insert_flight(jsonb_build_object('aircraft_description',repeat('A',501)))$$, '23514', null, 'Aircraft text bounded');
select throws_ok($$select pg_temp.insert_flight(jsonb_build_object('notes',repeat('N',2001)))$$, '23514', null, 'Notes bounded');
select throws_ok($$select pg_temp.insert_flight('{"aircraft_description":"  "}')$$, '23514', null, 'Blank aircraft rejected');
select throws_ok($$select pg_temp.insert_flight('{"aircraft_description":" C172"}')$$, '23514', null, 'Aircraft edge whitespace rejected');
select throws_ok($$select pg_temp.insert_flight(jsonb_build_object('aircraft_description',null))$$, '23502', null, 'Aircraft required');
select throws_ok($$select pg_temp.insert_flight('{"pilot_places":0}')$$, '23514', null, 'Zero joining capacity rejected');
select throws_ok($$select pg_temp.insert_flight('{"pilot_places":-1}')$$, '23514', null, 'Negative joining capacity rejected');
select throws_ok($$select pg_temp.insert_flight('{"pilot_places":1.5}')$$, '22P02', null, 'Fractional capacity rejected');
select throws_ok($$select pg_temp.insert_flight('{"pilot_places":null}')$$, '23502', null, 'Capacity required');
select throws_ok($$select pg_temp.insert_flight('{"departure_airport":"kpao"}')$$, '23514', null, 'Departure must be uppercase');
select throws_ok($$select pg_temp.insert_flight('{"destination_airport":"K-PAO"}')$$, '23514', null, 'Destination format enforced');
select throws_ok($$select pg_temp.insert_flight('{"departure_airport":"A"}')$$, '23514', null, 'Airport minimum enforced');
select throws_ok($$select pg_temp.insert_flight('{"destination_airport":"ABCDEFGHI"}')$$, '23514', null, 'Airport maximum enforced');
select throws_ok($$select pg_temp.insert_flight('{"departure_airport":null}')$$, '23502', null, 'Departure airport required');
select throws_ok($$select pg_temp.insert_flight('{"destination_airport":null}')$$, '23502', null, 'Destination airport required');
select throws_ok($$select pg_temp.insert_flight('{"visibility":"GROUP"}')$$, '22P02', null, 'Future GROUP mode rejected');
select throws_ok($$select pg_temp.insert_flight('{"visibility":null}')$$, '23502', null, 'Explicit visibility required');
select throws_ok($$select pg_temp.insert_flight('{"status":"published"}')$$, '22P02', null, 'Unapproved status rejected');
select throws_ok($$select pg_temp.insert_flight('{"owner_id":null}')$$, '23502', null, 'Owner required');
select throws_ok($$select pg_temp.insert_flight('{"owner_id":"17300000-0000-4000-8000-000000000006"}')$$, '23503', null, 'Auth existence without admission is not an owner FK');
select throws_ok($$select pg_temp.insert_flight('{"departure_at":"infinity"}')$$, '23514', null, 'Infinite departure rejected');
select throws_ok($$select pg_temp.insert_flight('{"departure_at":"-infinity"}')$$, '23514', null, 'Negative infinite departure rejected');
select throws_ok($$select pg_temp.insert_flight('{"departure_at":null}')$$, '23502', null, 'Departure instant required');
select throws_ok($$select pg_temp.insert_flight('{"departure_timezone":null}')$$, '23502', null, 'Departure zone required');
select throws_ok($$select pg_temp.insert_flight('{"departure_timezone":"Not/AZone"}')$$, '23514', null, 'Unknown zone rejected');
select throws_ok($$select pg_temp.insert_flight('{"departure_timezone":"PST"}')$$, '23514', null, 'Ambiguous abbreviation rejected');
select throws_ok($$select pg_temp.insert_flight('{"departure_timezone":"+03:00"}')$$, '23514', null, 'Arbitrary offset rejected');
select throws_ok($$select pg_temp.insert_flight('{"departure_timezone":"Etc/GMT+3"}')$$, '23514', null, 'Fixed-offset alias rejected');
select lives_ok($$select pg_temp.insert_flight('{"departure_timezone":"UTC"}')$$, 'UTC zone accepted');
select lives_ok($$select pg_temp.insert_flight('{"departure_timezone":"Pacific/Auckland"}')$$, 'IANA zone accepted');

-- Replace boundary fixtures with deterministic access fixtures.
delete from public.flights;
insert into public.flights (id,owner_id,departure_airport,destination_airport,departure_at,departure_timezone,aircraft_description,pilot_places,visibility)
values
 ('17310000-0000-4000-8000-000000000001','17300000-0000-4000-8000-000000000001','KPAO','KSFO','2026-01-01T07:30:00Z','America/Los_Angeles','C172',1,'NETWORK'),
 ('17310000-0000-4000-8000-000000000002','17300000-0000-4000-8000-000000000001','KPAO','KPAO','2026-07-01T07:30:00Z','America/Los_Angeles','C172',2,'PRIVATE');
select is((select status::text from public.flights limit 1), 'open', 'New flight initially open');
select is((select departure_local_date from public.flights where visibility='NETWORK'), date '2025-12-31', 'Winter local date uses standard time');
select is((select departure_local_date from public.flights where visibility='PRIVATE'), date '2026-07-01', 'Summer local date uses daylight time');
update public.flights set departure_at='2026-03-08T09:30:00Z',departure_timezone='Asia/Tokyo', departure_local_date='1900-01-01' where visibility='NETWORK';
select is((select departure_local_date from public.flights where visibility='NETWORK'), date '2026-03-08', 'Updating instant and zone recomputes date');
update public.flights set departure_timezone='America/Los_Angeles' where visibility='NETWORK';
select is((select departure_local_date from public.flights where visibility='NETWORK'), date '2026-03-08', 'Valid instant adjacent to DST gap retained');
select throws_ok($$update public.flights set owner_id='17300000-0000-4000-8000-000000000003' where visibility='PRIVATE'$$, '23514', null, 'Privileged owner reassignment rejected');
select throws_ok($$delete from public.memberships where user_id='17300000-0000-4000-8000-000000000001'$$, '23503', null, 'Owner membership retained by FK');
select throws_ok($$delete from auth.users where id='17300000-0000-4000-8000-000000000001'$$, '23503', null, 'Auth deletion cannot cascade flight history');

insert into public.flight_recipients (flight_id,user_id) values
 ('17310000-0000-4000-8000-000000000002','17300000-0000-4000-8000-000000000002'),
 ('17310000-0000-4000-8000-000000000002','17300000-0000-4000-8000-000000000007');
select throws_ok($$insert into public.flight_recipients (flight_id,user_id) values ('17310000-0000-4000-8000-000000000002','17300000-0000-4000-8000-000000000002')$$, '23505', null, 'Duplicate recipient rejected');
select throws_ok($$insert into public.flight_recipients (flight_id,user_id) values ('17310000-0000-4000-8000-000000000002','17300000-0000-4000-8000-000000000001')$$, '23514', null, 'Owner does not need recipient row');
select throws_ok($$insert into public.flight_recipients (flight_id,user_id) values ('17310000-0000-4000-8000-000000000001','17300000-0000-4000-8000-000000000003')$$, '23514', null, 'NETWORK cannot have selected recipients');
select throws_ok($$insert into public.flight_recipients (flight_id,user_id) values ('17310000-0000-4000-8000-000000000002','17300000-0000-4000-8000-000000000005')$$, '23514', null, 'Disabled recipient rejected');
select throws_ok($$insert into public.flight_recipients (flight_id,user_id) values ('17310000-0000-4000-8000-000000000002','17300000-0000-4000-8000-000000000006')$$, '23514', null, 'Unadmitted recipient rejected');
select throws_ok($$insert into public.flight_recipients (flight_id,user_id) values ('17310000-0000-4000-8000-999999999999','17300000-0000-4000-8000-000000000003')$$, '23503', null, 'Recipient requires existing flight');
select throws_ok($$delete from public.flights where visibility='PRIVATE'$$, '23503', null, 'Flight deletion cannot cascade recipient relationships');
select throws_ok($$delete from public.memberships where user_id='17300000-0000-4000-8000-000000000002'$$, '23503', null, 'Selected membership cannot be cascaded away');
select throws_ok($$update public.flights set visibility='NETWORK' where visibility='PRIVATE'$$, '23514', null, 'Mode change cannot leave NETWORK recipient rows');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.flights'::regclass,'public.flight_recipients'::regclass)), 'Both tables have RLS');

set local role anon;
select throws_ok('select * from public.flights', '42501', null, 'Anonymous flight reads denied');
select throws_ok('select * from public.flight_recipients', '42501', null, 'Anonymous audience reads denied');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"17300000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(*)::integer from public.flights), 2, 'Active owner reads both modes without recipient row');
select is((select count(*)::integer from public.flight_recipients), 2, 'Owner sees audience');
select throws_ok($$insert into public.flights (departure_airport) values ('KPAO')$$, '42501', null, 'Direct flight creation denied');
select throws_ok($$update public.flights set visibility='NETWORK'$$, '42501', null, 'Direct owner visibility edits denied');
select throws_ok('delete from public.flights', '42501', null, 'Direct owner deletion denied');
select throws_ok('delete from public.flight_recipients', '42501', null, 'Direct owner recipient removal denied');
select throws_ok($$update public.flight_recipients set user_id='17300000-0000-4000-8000-000000000003'$$, '42501', null, 'Direct audience widening denied');
select set_config('request.jwt.claims','{"sub":"17300000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*)::integer from public.flights), 2, 'Active selected recipient reads both modes');
select is((select count(*)::integer from public.flight_recipients), 1, 'Selected recipient sees only own eligibility');
select is((select count(*)::integer from public.flight_recipients where user_id='17300000-0000-4000-8000-000000000007'), 0, 'Another selected identity remains hidden');
select throws_ok($$insert into public.flight_recipients (flight_id,user_id) values ('17310000-0000-4000-8000-000000000002',auth.uid())$$, '42501', null, 'Recipient self-addition denied');
select throws_ok($$update public.flights set owner_id=auth.uid()$$, '42501', null, 'Foreign owner spoofing denied');
select set_config('request.jwt.claims','{"sub":"17300000-0000-4000-8000-000000000003","role":"authenticated","user_metadata":{"role":"admin","status":"active"}}',true);
select is((select count(*)::integer from public.flights), 1, 'Unrelated member sees only NETWORK despite metadata');
select is((select count(*)::integer from public.flights where id='17310000-0000-4000-8000-000000000002'), 0, 'Direct PRIVATE id hidden');
select is((select count(*)::integer from public.flight_recipients), 0, 'Unrelated audience count empty');
select is((select count(*)::integer from public.flights f join public.flight_recipients r on r.flight_id=f.id), 0, 'Join cannot expose hidden flight/audience');
select set_config('request.jwt.claims','{"sub":"17300000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*)::integer from public.flights), 1, 'Unrelated active admin has no PRIVATE bypass');
select is((select count(*)::integer from public.flight_recipients), 0, 'Admin has no audience bypass');
select set_config('request.jwt.claims','{"sub":"17300000-0000-4000-8000-000000000005","role":"authenticated","user_metadata":{"role":"admin","status":"active"}}',true);
select is((select count(*)::integer from public.flights), 0, 'Disabled member cannot read NETWORK');
select set_config('request.jwt.claims','{"sub":"17300000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select is((select count(*)::integer from public.flights), 0, 'Unadmitted Auth identity cannot read flights');
select is((select count(*)::integer from public.flight_recipients), 0, 'Unadmitted Auth identity cannot inspect eligibility');
reset role;

-- Preserve exact JWT and selection while current membership changes.
select set_config('request.jwt.claims','{"sub":"17300000-0000-4000-8000-000000000002","role":"authenticated"}',true);
update public.memberships set status='disabled',disabled_at=now(),disabled_reason='Owned disable' where user_id='17300000-0000-4000-8000-000000000002';
set local role authenticated;
select is((select count(*)::integer from public.flights), 0, 'Existing recipient JWT loses all flight reads after disabling');
select is((select count(*)::integer from public.flight_recipients), 0, 'Disabled selected recipient loses eligibility reads');
reset role;
update public.memberships set status='active',disabled_at=null,disabled_reason=null where user_id='17300000-0000-4000-8000-000000000002';
set local role authenticated;
select is((select count(*)::integer from public.flights), 2, 'Reactivated selected member regains existing visibility');
reset role;
delete from public.flight_recipients where user_id='17300000-0000-4000-8000-000000000002';
set local role authenticated;
select is((select count(*)::integer from public.flights), 1, 'Removed selection revokes current PRIVATE read');
reset role;
select set_config('request.jwt.claims','{"sub":"17300000-0000-4000-8000-000000000001","role":"authenticated"}',true);
update public.memberships set status='disabled',disabled_at=now(),disabled_reason='Owned disable' where user_id='17300000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*)::integer from public.flights), 0, 'Disabled owner loses own flight access');
select is((select count(*)::integer from public.flight_recipients), 0, 'Disabled owner loses audience access');
reset role;
select * from finish();
rollback;
