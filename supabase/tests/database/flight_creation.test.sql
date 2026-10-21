begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_function('public','create_flight',array['text','text','timestamp with time zone','text','text','integer','text','flight_visibility'],'Guarded creation RPC exists');
select function_returns('public','create_flight',array['text','text','timestamp with time zone','text','text','integer','text','flight_visibility'],'uuid','Creation returns only a flight UUID');
insert into auth.users(id,email)
select ('17600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'create-'||n||'@example.invalid' from generate_series(1,6) n;
insert into public.memberships(user_id,role,status,disabled_at,disabled_reason)
select ('17600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 case when n=1 then 'admin' else 'member' end::public.member_role,
 case when n=3 then 'disabled' else 'active' end::public.membership_status,
 case when n=3 then now() end,case when n=3 then 'Owned fixture' end
from generate_series(1,6) n where n<>4;
insert into public.profiles(user_id,display_name,home_airport,pilot_designation)
select ('17600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Create pilot','KPAO','licensed' from generate_series(1,3) n;
create function pg_temp.new_flight(overrides jsonb default '{}') returns uuid language plpgsql as $$
declare v jsonb;
begin
 v:=jsonb_build_object('departure_airport','KPAO','destination_airport','KPAO',
  'departure_at',(clock_timestamp()+interval '2 days')::text,'departure_timezone','America/Los_Angeles',
  'aircraft_description','Owned C172','pilot_places',2,'notes','','visibility','NETWORK')||overrides;
 return public.create_flight(v->>'departure_airport',v->>'destination_airport',(v->>'departure_at')::timestamptz,
  v->>'departure_timezone',v->>'aircraft_description',(v->>'pilot_places')::integer,v->>'notes',(v->>'visibility')::public.flight_visibility);
end;$$;
set local role anon;
select throws_ok($$select pg_temp.new_flight()$$,'42501',null,'Anonymous creation denied');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select pg_temp.new_flight()$$,'42501',null,'Missing subject denied');
select set_config('request.jwt.claims','{"sub":"17600000-0000-4000-8000-000000000004","role":"authenticated","user_metadata":{"role":"admin","status":"active"}}',true);
select throws_ok($$select pg_temp.new_flight()$$,'42501',null,'Auth account and spoofed metadata do not establish membership');
select set_config('request.jwt.claims','{"sub":"17600000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select throws_ok($$select pg_temp.new_flight()$$,'42501',null,'Disabled member with profile denied');
select set_config('request.jwt.claims','{"sub":"17600000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select throws_ok($$select pg_temp.new_flight()$$,'42501',null,'Active member without completed profile denied');
select set_config('request.jwt.claims','{"sub":"17600000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select lives_ok($$select pg_temp.new_flight()$$,'Completed member creates flight');
select is((select count(*)::integer from public.flights where owner_id=auth.uid()),1,'One owned flight created');
select is((select status::text from public.flights where owner_id=auth.uid()),'open','Status is server-derived open');
select is((select notes from public.flights where owner_id=auth.uid()),null::text,'Empty RPC notes normalize to optional NULL');
select is((select departure_local_date from public.flights where owner_id=auth.uid()),(select (departure_at at time zone departure_timezone)::date from public.flights where owner_id=auth.uid()),'Database derives departure-local date');
select matches((select id::text from public.flights where owner_id=auth.uid()),'^[0-9a-f-]{36}$','Generated flight identity is a UUID');
select throws_ok($$select pg_temp.new_flight('{"departure_at":null}')$$,'22023',null,'Missing departure rejected');
select throws_ok($$select pg_temp.new_flight('{"departure_at":"infinity"}')$$,'22023',null,'Infinite departure rejected');
select throws_ok($$select pg_temp.new_flight('{"departure_at":"-infinity"}')$$,'22023',null,'Negative infinite departure rejected');
select throws_ok($$select pg_temp.new_flight('{"departure_at":"2000-01-01T00:00Z"}')$$,'22023',null,'Past flight rejected at database boundary');
select pg_sleep(0.01);
select throws_ok($$select pg_temp.new_flight(jsonb_build_object('departure_at',transaction_timestamp()+interval '1 millisecond'))$$,'22023',null,'Wall clock, not transaction start, determines upcoming eligibility');
select throws_ok($$select pg_temp.new_flight('{"pilot_places":0}')$$,'23514',null,'RPC cannot bypass positive capacity constraint');
select throws_ok($$select pg_temp.new_flight(jsonb_build_object('notes',repeat('N',2001)))$$,'23514',null,'RPC cannot bypass bounded notes');
select throws_ok($$select pg_temp.new_flight('{"departure_timezone":"PST"}')$$,'23514',null,'RPC cannot bypass named-zone constraint');
select throws_ok($$select pg_temp.new_flight('{"departure_airport":"kpao"}')$$,'23514',null,'RPC cannot bypass normalized airport constraint');
select throws_ok($$select public.create_flight(p_departure_airport=>'KPAO',p_destination_airport=>'KPAO',p_departure_at=>now()+interval '2 days',p_departure_timezone=>'UTC',p_aircraft_description=>'C172',p_pilot_places=>1,p_notes=>null,p_visibility=>'NETWORK',p_owner_id=>'17600000-0000-4000-8000-000000000001')$$,'42883',null,'No caller-selected owner signature');
select throws_ok($$select public.create_flight(p_departure_airport=>'KPAO',p_destination_airport=>'KPAO',p_departure_at=>now()+interval '2 days',p_departure_timezone=>'UTC',p_aircraft_description=>'C172',p_pilot_places=>1,p_notes=>null,p_visibility=>'NETWORK',p_status=>'completed')$$,'42883',null,'No caller-selected status signature');
select throws_ok($$insert into public.flights(departure_airport) values ('KPAO')$$,'42501',null,'Direct table insert remains disabled');
select is((select count(*)::integer from public.flights where owner_id=auth.uid()),1,'Rejected calls insert no records');
select lives_ok($$select pg_temp.new_flight('{"visibility":"PRIVATE"}')$$,'Completed member creates PRIVATE flight without widening audience');
select is((select count(*)::integer from public.flight_recipients),0,'Creation adds no recipient rows');
select set_config('request.jwt.claims','{"sub":"17600000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select is((select count(*)::integer from public.flights where owner_id='17600000-0000-4000-8000-000000000002'),1,'Unrelated member sees only created NETWORK flight');
select set_config('request.jwt.claims','{"sub":"17600000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select pg_temp.new_flight()$$,'Completed admin creates their own flight');
select is((select count(*)::integer from public.flights where owner_id=auth.uid()),1,'Admin creation does not impersonate another owner');
reset role;
update public.memberships set status='disabled',disabled_at=now(),disabled_reason='Owned revoke' where user_id='17600000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"17600000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select pg_temp.new_flight()$$,'42501',null,'Retained JWT cannot create after membership revocation');
reset role;
update public.memberships set status='active',disabled_at=null,disabled_reason=null where user_id='17600000-0000-4000-8000-000000000002';
delete from public.profiles where user_id='17600000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select pg_temp.new_flight()$$,'42501',null,'Final database profile check cannot be bypassed by stale prechecks');
reset role;
select is((select count(*)::integer from public.flights where owner_id in ('17600000-0000-4000-8000-000000000001','17600000-0000-4000-8000-000000000002')),3,'Final denied calls preserve the three confirmed creations');
select * from finish();
rollback;
