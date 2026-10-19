begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_function('public', 'list_directory_profiles', array['uuid','integer','text'], 'Directory query exists');
select has_function('public', 'get_network_profile', array['uuid'], 'Targeted network profile query exists');
insert into auth.users(id,email) values
 ('61000000-0000-4000-8000-000000000001','directory-admin@example.invalid'),
 ('61000000-0000-4000-8000-000000000002','directory-disabled@example.invalid'),
 ('61000000-0000-4000-8000-000000000003','directory-member@example.invalid'),
 ('61000000-0000-4000-8000-000000000004','directory-incomplete@example.invalid'),
 ('61000000-0000-4000-8000-000000000005','directory-unadmitted@example.invalid');
insert into public.memberships(user_id,role,status,disabled_at,disabled_reason) values
 ('61000000-0000-4000-8000-000000000001','admin','active',null,null),
 ('61000000-0000-4000-8000-000000000002','member','disabled',now(),'Fixture'),
 ('61000000-0000-4000-8000-000000000003','member','active',null,null),
 ('61000000-0000-4000-8000-000000000004','member','active',null,null);
insert into public.profiles(user_id,display_name,home_airport,pilot_designation) values
 ('61000000-0000-4000-8000-000000000001','Same name','KPAO','licensed'),
 ('61000000-0000-4000-8000-000000000002','Disabled','KPAO','licensed'),
 ('61000000-0000-4000-8000-000000000003','Same name','KPAO','licensed'),
 ('61000000-0000-4000-8000-000000000005','Unadmitted','KPAO','licensed');

set local role anon;
select throws_ok('select * from public.list_directory_profiles()', '42501', null, 'Anonymous RPC denied');
select throws_ok($$select * from public.get_network_profile('61000000-0000-4000-8000-000000000001')$$, '42501', null, 'Anonymous targeted profile RPC denied');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
-- Cursor scopes this test away from earlier seed IDs without depending on seeds.
select results_eq($$select user_id from public.list_directory_profiles('61000000-0000-4000-8000-000000000000',1)$$,
 $$values ('61000000-0000-4000-8000-000000000001'::uuid),('61000000-0000-4000-8000-000000000003'::uuid)$$,
 'Page contains active admin and member, including viewer; inactive row does not consume lookahead');
select results_eq($$select user_id from public.list_directory_profiles('61000000-0000-4000-8000-000000000001',1)$$,
 $$values ('61000000-0000-4000-8000-000000000003'::uuid)$$,'Exclusive cursor advances across disabled target');
select is((select count(*)::integer from public.list_directory_profiles('61000000-0000-4000-8000-000000000003',1)),0,'Final page is empty');
select ok((select not photo_available from public.list_directory_profiles('61000000-0000-4000-8000-000000000000',1) limit 1),'Missing photo is represented safely');
select results_eq($$select k from (select * from public.list_directory_profiles('61000000-0000-4000-8000-000000000000',1) limit 1) d, lateral jsonb_object_keys(to_jsonb(d)) k order by k$$,
 $$select unnest(array['aircraft_access','bio','certificates','display_name','flying_interests','home_airport','photo_available','pilot_designation','ratings','user_id'])$$,
 'RPC exposes only explicit profile fields');
select is((select count(*)::integer from public.memberships),1,'Membership RLS still exposes only viewer record');
select results_eq($$select user_id from public.get_network_profile('61000000-0000-4000-8000-000000000003')$$,
 $$values ('61000000-0000-4000-8000-000000000003'::uuid)$$,'Active viewer reads only the requested other pilot');
select is((select count(*)::integer from public.get_network_profile('61000000-0000-4000-8000-000000000001')),1,'Active admin can view own profile');
select is((select count(*)::integer from public.get_network_profile('61000000-0000-4000-8000-000000000002')),0,'Disabled target is indistinguishable from missing');
select is((select count(*)::integer from public.get_network_profile('61000000-0000-4000-8000-000000000004')),0,'Active target without profile is missing');
select is((select count(*)::integer from public.get_network_profile('61000000-0000-4000-8000-000000000005')),0,'Retained unadmitted profile is missing');
select is((select count(*)::integer from public.get_network_profile('61000000-0000-4000-8000-999999999999')),0,'Unknown target is missing');
select is((select count(*)::integer from public.get_network_profile(null)),0,'Null target cannot list profiles');
select results_eq($$select jsonb_object_keys(to_jsonb(p)) k from public.get_network_profile('61000000-0000-4000-8000-000000000003') p order by k$$,
 $$select unnest(array['aircraft_access','bio','certificates','display_name','flying_interests','home_airport','photo_available','pilot_designation','ratings','user_id'])$$,
 'Targeted RPC exposes only approved fields');
-- Search must filter eligible rows before cursor lookahead, never just the visible page.
select results_eq($$select user_id from public.list_directory_profiles('61000000-0000-4000-8000-000000000000',1,'  SAME   name  ')$$,
 $$values ('61000000-0000-4000-8000-000000000001'::uuid),('61000000-0000-4000-8000-000000000003'::uuid)$$,'Name search ignores case and repeated whitespace');
select is((select count(*)::integer from public.list_directory_profiles('61000000-0000-4000-8000-000000000000',20,'pAo')),2,'Airport substring search excludes inaccessible pilots');
select is((select count(*)::integer from public.list_directory_profiles(null,20,'Disabled')),0,'Search does not expose disabled targets');
select is((select count(*)::integer from public.list_directory_profiles(null,20,'Unadmitted')),0,'Search does not expose unadmitted targets');
select is((select count(*)::integer from public.list_directory_profiles(null,20,'no-such-pilot')),0,'No matches return an empty result');
select is((select count(*)::integer from public.list_directory_profiles(null,20,'%')),0,'Percent is literal rather than a wildcard');
select is((select count(*)::integer from public.list_directory_profiles(null,20,'_')),0,'Underscore is literal rather than a wildcard');
select is((select count(*)::integer from public.list_directory_profiles('61000000-0000-4000-8000-000000000001',1,'same')),1,'Search cursor advances without overlap');
select throws_ok($$select * from public.list_directory_profiles(null,20,repeat('x',81))$$,'22023',null,'Oversized search rejected in database');
select throws_ok($$select * from public.list_directory_profiles(null,20,null)$$,'22023',null,'Explicit null search rejected in database');
select throws_ok('select * from public.list_directory_profiles(null,0)','22023',null,'Zero page size rejected');
select throws_ok('select * from public.list_directory_profiles(null,51)','22023',null,'Oversized page rejected');
select throws_ok('select * from public.list_directory_profiles(null,null)','22023',null,'Null page size rejected');
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*)::integer from public.list_directory_profiles('61000000-0000-4000-8000-000000000000')),2,'Active viewer without profile can browse');
select is((select count(*)::integer from public.get_network_profile('61000000-0000-4000-8000-000000000003')),1,'Viewer without profile can open another pilot');
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000002","role":"authenticated","user_metadata":{"role":"admin","status":"active"}}',true);
select is((select count(*)::integer from public.list_directory_profiles()),0,'Disabled viewer cannot bypass with metadata');
select is((select count(*)::integer from public.get_network_profile('61000000-0000-4000-8000-000000000001')),0,'Disabled viewer cannot read targeted profile with spoofed metadata');
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000005","role":"authenticated","user_metadata":{"role":"admin","status":"active"}}',true);
select is((select count(*)::integer from public.list_directory_profiles()),0,'Unadmitted viewer cannot bypass with metadata');
select is((select count(*)::integer from public.get_network_profile('61000000-0000-4000-8000-000000000001')),0,'Unadmitted viewer cannot read targeted profile');
reset role;
update public.memberships set status='disabled',disabled_at=now(),disabled_reason='Revoked' where user_id='61000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(*)::integer from public.list_directory_profiles('61000000-0000-4000-8000-000000000001')),0,'Target revocation removes retained profile immediately');
select is((select count(*)::integer from public.get_network_profile('61000000-0000-4000-8000-000000000003')),0,'Fresh target revocation removes direct profile access');
reset role;
select ok(not (select prosecdef from pg_proc where oid='public.list_directory_profiles(uuid,integer,text)'::regprocedure),'Profile query runs with caller RLS');
select ok((select not prosecdef and provolatile='s' from pg_proc where oid='public.get_network_profile(uuid)'::regprocedure),'Targeted read preserves caller RLS and is read-only');
select ok(not has_schema_privilege('anon','directory_private','usage'),'Anonymous clients cannot use eligibility schema');
select ok(not has_function_privilege('anon','directory_private.active_profile_owner(uuid)','execute'),'Eligibility helper denies anonymous callers');
select ok(not has_function_privilege('service_role','public.list_directory_profiles(uuid,integer,text)','execute'),'Directory RPC is intended for member sessions only');
update public.profiles set photo_storage_path='61000000-0000-4000-8000-000000000001/placeholder.webp'
 where user_id='61000000-0000-4000-8000-000000000001';
-- Enough independent rows to exercise both default and maximum page bounds.
insert into auth.users(id,email)
 select ('62000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'directory-page-'||n||'@example.invalid' from generate_series(1,52) n;
insert into public.memberships(user_id)
 select ('62000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,52) n;
insert into public.profiles(user_id,display_name,home_airport,pilot_designation)
 select ('62000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Page Pilot','KPAO','licensed' from generate_series(1,52) n;
set local role authenticated;
select ok((select photo_available from public.list_directory_profiles('61000000-0000-4000-8000-000000000000',1) limit 1),'Existing photo pointer becomes boolean availability');
select ok((select photo_available from public.get_network_profile('61000000-0000-4000-8000-000000000001')),'Targeted profile exposes photo availability without path');
select is((select count(*)::integer from public.list_directory_profiles('62000000-0000-4000-8000-000000000000')),21,'Default is twenty rows plus lookahead');
select is((select count(*)::integer from public.list_directory_profiles('62000000-0000-4000-8000-000000000000',50)),51,'Maximum is fifty rows plus lookahead');
select results_eq($$select user_id from public.list_directory_profiles('62000000-0000-4000-8000-000000000050',50)$$,
 $$values ('62000000-0000-4000-8000-000000000051'::uuid),('62000000-0000-4000-8000-000000000052'::uuid)$$,'Last bounded page returns remaining rows without overlap');
reset role;
update public.profiles set display_name=E'Élodie\t Pilot',home_airport='KSQL'
 where user_id='62000000-0000-4000-8000-000000000052';
set local role authenticated;
select results_eq($$select user_id from public.list_directory_profiles(null,1,'éLODIE   pilot')$$,
 $$values ('62000000-0000-4000-8000-000000000052'::uuid)$$,'Late name match is filtered before page size and normalizes stored whitespace');
select results_eq($$select user_id from public.list_directory_profiles(null,1,'sql')$$,
 $$values ('62000000-0000-4000-8000-000000000052'::uuid)$$,'Late airport match is filtered before page size');
select is((select count(*)::integer from public.list_directory_profiles('62000000-0000-4000-8000-000000000000',50,U&'\00A0\2003')),51,'Unicode whitespace search is unfiltered');
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*)::integer from public.list_directory_profiles(null,20,'Page')),0,'Disabled viewer cannot search matching public profiles');
reset role;
select * from finish();
rollback;
