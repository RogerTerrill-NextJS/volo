begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_function('public','submit_flight_interest',array['uuid','text'],'Guarded interest submission exists');
insert into auth.users(id,email) select ('18900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'interest-'||n||'@example.invalid' from generate_series(1,8) n;
insert into public.memberships(user_id,role,status,disabled_at,disabled_reason)
select ('18900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 case when n>=7 then 'admin' else 'member' end::public.member_role,
 case when n=4 then 'disabled' else 'active' end::public.membership_status,
 case when n=4 then now() end,case when n=4 then 'Owned fixture' end
from generate_series(1,8) n where n<>6;
insert into public.profiles(user_id,display_name,home_airport,pilot_designation)
select ('18900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Interest pilot','KPAO','licensed' from generate_series(1,8) n where n in(1,2,3,4,8);
insert into public.flights(id,owner_id,departure_airport,destination_airport,departure_at,departure_timezone,aircraft_description,pilot_places,visibility,status)
select ('18910000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'18900000-0000-4000-8000-000000000001','KPAO','KSQL',
 case when n=3 then now()-interval '1 day' else now()+interval '2 days' end,'UTC','C172',1,
 case when n=2 then 'PRIVATE' else 'NETWORK' end::public.flight_visibility,
 case when n=4 then 'cancelled' when n=5 then 'completed' else 'open' end::public.flight_status from generate_series(1,5) n;
insert into public.flight_recipients(flight_id,user_id) values('18910000-0000-4000-8000-000000000002','18900000-0000-4000-8000-000000000002');
create function pg_temp.submit(f integer default 1,note text default null) returns jsonb language sql as $$
 select public.submit_flight_interest(('18910000-0000-4000-8000-'||lpad(f::text,12,'0'))::uuid,note);
$$;
set local role anon;
select throws_ok($$select pg_temp.submit()$$,'42501',null,'Anonymous direct RPC denied');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select pg_temp.submit()$$,'42501',null,'Missing authenticated identity denied');
select set_config('request.jwt.claims','{"sub":"18900000-0000-4000-8000-000000000006","user_metadata":{"role":"admin","status":"active"}}',true);
select throws_ok($$select pg_temp.submit()$$,'42501',null,'Auth identity and spoofed claims do not grant membership');
select set_config('request.jwt.claims','{"sub":"18900000-0000-4000-8000-000000000004"}',true);
select throws_ok($$select pg_temp.submit()$$,'42501',null,'Disabled member denied');
select set_config('request.jwt.claims','{"sub":"18900000-0000-4000-8000-000000000005"}',true);
select throws_ok($$select pg_temp.submit()$$,'42501',null,'Incomplete member denied');
select set_config('request.jwt.claims','{"sub":"18900000-0000-4000-8000-000000000007"}',true);
select throws_ok($$select pg_temp.submit()$$,'42501',null,'Admin cannot bypass profile gate');
select set_config('request.jwt.claims','{"sub":"18900000-0000-4000-8000-000000000001"}',true);
select is(pg_temp.submit()->>'code','flight_unavailable','Self request denied safely');
select set_config('request.jwt.claims','{"sub":"18900000-0000-4000-8000-000000000003"}',true);
select is(pg_temp.submit(2),'{"code":"flight_unavailable"}'::jsonb,'Private ineligible and nonexistent flight have same result');
select is(pg_temp.submit(99),'{"code":"flight_unavailable"}'::jsonb,'Missing flight does not disclose existence');
select is(pg_temp.submit(3)->>'code','flight_unavailable','Past flight denied');
select is(pg_temp.submit(4)->>'code','flight_unavailable','Cancelled flight denied');
select is(pg_temp.submit(5)->>'code','flight_unavailable','Completed flight denied');
select set_config('request.jwt.claims','{"sub":"18900000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select public.submit_flight_interest(null,null)$$,'22023',null,'Null flight rejected');
select throws_ok($$select pg_temp.submit(1,repeat('N',501))$$,'22023',null,'Oversized direct RPC note rejected');
select is(pg_temp.submit(1,'Hello')->>'code','submitted','Eligible network interest creates pending record');
select is((select requester_id from public.flight_requests),auth.uid(),'Requester derived from identity');
select is((select status::text from public.flight_requests),'pending','Creation cannot choose state');
select matches(pg_temp.submit()->>'requestId','^[0-9a-f-]{36}$','Confirmation uses real request UUID');
select is(pg_temp.submit(1,'Overwrite')->>'code','already_requested','Duplicate is safe existing result');
select is((select introductory_note from public.flight_requests),'Hello','Duplicate preserves original introduction');
select is((select count(*)::integer from public.flight_requests),1,'Repeated submission creates one record');
select is(pg_temp.submit(2,repeat('😀',500))->>'code','submitted','Selected private recipient may submit Unicode boundary note');
select throws_ok($$select public.submit_flight_interest(p_flight_id=>'18910000-0000-4000-8000-000000000001',p_introductory_note=>'spoof',p_requester_id=>'18900000-0000-4000-8000-000000000003')$$,'42883',null,'No caller-selected requester signature');
select throws_ok($$insert into public.flight_requests(flight_id,requester_id) values('18910000-0000-4000-8000-000000000001',auth.uid())$$,'42501',null,'Direct table insertion stays closed');
select throws_ok($$update public.flight_requests set status='accepted'$$,'42501',null,'Direct state updates stay closed');
reset role;
create temporary table saved_interest as select id,created_at from public.flight_requests;
update public.flight_requests set status='withdrawn' where flight_id='18910000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.submit(1,'New hello')->>'code','submitted','Withdrawn resubmits after eligibility checks');
select is((select introductory_note from public.flight_requests where flight_id='18910000-0000-4000-8000-000000000001'),'New hello','Resubmission replaces note');
reset role;
select ok((select bool_and(r.created_at=s.created_at) from public.flight_requests r join saved_interest s using(id)),'Resubmission preserves IDs and creation time');
update public.flight_requests set status='accepted' where flight_id='18910000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.submit(1)->>'status','accepted','Existing accepted request is reported without a new full-flight submission');
select set_config('request.jwt.claims','{"sub":"18900000-0000-4000-8000-000000000003"}',true);
select is(pg_temp.submit(1),'{"code":"flight_unavailable"}'::jsonb,'Full flight rejects new interest without exposing accepted pilots');
reset role;
update public.flight_requests set status='withdrawn' where flight_id='18910000-0000-4000-8000-000000000002';
-- Removal/re-add of a withdrawn recipient preserves the withdrawn record, but
-- resubmission must check selection again before any update.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"18900000-0000-4000-8000-000000000001"}',true);
select public.change_flight_recipient('18910000-0000-4000-8000-000000000002','18900000-0000-4000-8000-000000000002',false);
select set_config('request.jwt.claims','{"sub":"18900000-0000-4000-8000-000000000002"}',true);
select is(pg_temp.submit(2)->>'code','flight_unavailable','Withdrawn resubmission cannot bypass removed private selection');
select set_config('request.jwt.claims','{"sub":"18900000-0000-4000-8000-000000000001"}',true);
select public.change_flight_recipient('18910000-0000-4000-8000-000000000002','18900000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"18900000-0000-4000-8000-000000000002"}',true);
select is(pg_temp.submit(2)->>'code','submitted','Re-eligible withdrawn request may resubmit');
reset role;
update public.flight_requests set status='declined' where flight_id='18910000-0000-4000-8000-000000000002';
set local role authenticated;
select is(pg_temp.submit(2),'{"code":"request_closed"}'::jsonb,'Declined request cannot resubmit');
reset role;
update public.flight_requests set status='cancelled' where flight_id='18910000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.submit(1),'{"code":"request_closed"}'::jsonb,'Cancelled request cannot resubmit');
reset role;
update public.memberships set status='disabled',disabled_at=now(),disabled_reason='Owned revoke' where user_id='18900000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.submit(1)->>'code','flight_unavailable','Disabled owner cannot receive interest');
reset role;
update public.memberships set status='active',disabled_at=null,disabled_reason=null where user_id='18900000-0000-4000-8000-000000000001';
update public.memberships set status='disabled',disabled_at=now(),disabled_reason='Owned revoke' where user_id='18900000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select pg_temp.submit()$$,'42501',null,'Retained identity loses submission permission after disablement');
reset role;
select * from finish();
rollback;
