begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_table('public','flight_requests','Request persistence exists');
insert into auth.users(id,email)
select ('18800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'request-'||n||'@example.invalid' from generate_series(1,7) n;
insert into public.memberships(user_id,role,status,disabled_at,disabled_reason)
select ('18800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 case when n=4 then 'admin' else 'member' end::public.member_role,
 case when n=5 then 'disabled' else 'active' end::public.membership_status,
 case when n=5 then now() end,case when n=5 then 'Owned fixture' end
from generate_series(1,6) n;
insert into public.profiles(user_id,display_name,home_airport,pilot_designation)
select ('18800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Request pilot','KPAO','licensed' from generate_series(1,5) n;
insert into public.flights(id,owner_id,departure_airport,destination_airport,departure_at,departure_timezone,aircraft_description,pilot_places,visibility,status)
select ('18810000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'18800000-0000-4000-8000-000000000001',
 'KPAO','KSQL',case when n=3 then now()-interval '1 day' else now()+interval '2 days' end,'UTC','C172',1,
 case when n=2 then 'PRIVATE' else 'NETWORK' end::public.flight_visibility,
 case when n=4 then 'cancelled' when n=5 then 'completed' else 'open' end::public.flight_status
from generate_series(1,6) n;
insert into public.flight_recipients(flight_id,user_id) values('18810000-0000-4000-8000-000000000002','18800000-0000-4000-8000-000000000002');
create function pg_temp.request(f integer default 1,r integer default 2,note text default null,s text default 'pending') returns uuid language sql as $$
 insert into public.flight_requests(flight_id,requester_id,introductory_note,status)
 values(('18810000-0000-4000-8000-'||lpad(f::text,12,'0'))::uuid,('18800000-0000-4000-8000-'||lpad(r::text,12,'0'))::uuid,note,s::public.flight_request_status) returning id;
$$;
create function pg_temp.transition(s text,f integer default 1,r integer default 2) returns void language sql as $$
 update public.flight_requests set status=s::public.flight_request_status
 where flight_id=('18810000-0000-4000-8000-'||lpad(f::text,12,'0'))::uuid and requester_id=('18800000-0000-4000-8000-'||lpad(r::text,12,'0'))::uuid;
$$;
select throws_ok($$select pg_temp.request(1,1)$$,'23514',null,'Self request rejected');
select throws_ok($$select pg_temp.request(1,5)$$,'23514',null,'Disabled requester rejected');
select throws_ok($$select pg_temp.request(1,6)$$,'23514',null,'Incomplete requester rejected');
select throws_ok($$select pg_temp.request(1,7)$$,'23514',null,'Unadmitted requester rejected');
select throws_ok($$select pg_temp.request(3)$$,'23514',null,'Past flight rejected');
select throws_ok($$select pg_temp.request(4)$$,'23514',null,'Cancelled flight rejected');
select throws_ok($$select pg_temp.request(5)$$,'23514',null,'Completed flight rejected');
select throws_ok($$select pg_temp.request(2,3)$$,'23514',null,'Unselected private requester rejected');
select throws_ok($$select pg_temp.request(99)$$,'23503',null,'Missing flight rejected');
select throws_ok($$select pg_temp.request(1,2,null,'accepted')$$,'23514',null,'New request must start pending');
select throws_ok($$select pg_temp.request(1,2,repeat('n',501))$$,'23514',null,'Introductory note is bounded');
select lives_ok($$select pg_temp.request(1,2,repeat('n',500))$$,'Boundary note accepted');
select throws_ok($$select pg_temp.request()$$,'23505',null,'Duplicate flight/requester rejected');
select throws_ok($$update public.flight_requests set requester_id='18800000-0000-4000-8000-000000000003'$$,'23514',null,'Requester is immutable');
select throws_ok($$update public.flight_requests set flight_id='18810000-0000-4000-8000-000000000002'$$,'23514',null,'Flight is immutable');
select throws_ok($$update public.flight_requests set id=gen_random_uuid()$$,'23514',null,'Request identity is immutable');
select lives_ok($$select pg_temp.transition('withdrawn')$$,'Pending may be withdrawn');
update public.flights set status='cancelled' where id='18810000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.transition('pending')$$,'23514',null,'Resubmission rechecks flight availability');
update public.flights set status='open' where id='18810000-0000-4000-8000-000000000001';
update public.memberships set status='disabled',disabled_at=now(),disabled_reason='Owned revoke' where user_id='18800000-0000-4000-8000-000000000002';
select throws_ok($$select pg_temp.transition('pending')$$,'23514',null,'Resubmission rechecks membership');
update public.memberships set status='active',disabled_at=null,disabled_reason=null where user_id='18800000-0000-4000-8000-000000000002';
select lives_ok($$update public.flight_requests set status='pending',introductory_note='Updated introduction' where status='withdrawn'$$,'Withdrawn request resubmits with a fresh note on same record');
select is((select introductory_note from public.flight_requests),'Updated introduction','Resubmission stores replacement introduction');
select throws_ok($$update public.flight_requests set introductory_note='Rewrite history'$$,'23514',null,'Introduction cannot be rewritten outside resubmission');
select is((select count(*)::integer from public.flight_requests),1,'Resubmission retains one record');
select lives_ok($$select pg_temp.transition('accepted')$$,'Pending may be accepted');
select lives_ok($$select pg_temp.request(1,3)$$,'Schema permits pending interest while full; submission policy belongs to VOLO-64');
select throws_ok($$select pg_temp.transition('accepted',1,3)$$,'23514',null,'Acceptance cannot exceed joining capacity');
select throws_ok($$select pg_temp.transition('withdrawn')$$,'23514',null,'Accepted withdrawal stays closed until VOLO-67 decision');
select throws_ok($$select pg_temp.transition('pending')$$,'23514',null,'Accepted cannot revert to pending');
select lives_ok($$select pg_temp.transition('cancelled')$$,'Accepted can be cancelled');
select throws_ok($$select pg_temp.transition('pending')$$,'23514',null,'Cancelled is terminal');
select lives_ok($$select pg_temp.transition('declined',1,3)$$,'Pending can be declined');
select throws_ok($$select pg_temp.transition('pending',1,3)$$,'23514',null,'Declined is terminal');
select throws_ok($$delete from public.flights where id='18810000-0000-4000-8000-000000000001'$$,'23503',null,'Flight deletion preserves request history');
select throws_ok($$delete from public.memberships where user_id='18800000-0000-4000-8000-000000000002'$$,'23503',null,'Requester deletion preserves shared history');
create temporary table request_times as select id,created_at,updated_at,status_changed_at from public.flight_requests;
update public.flight_requests set created_at='2000-01-01',updated_at='2000-01-01',status_changed_at='2000-01-01';
select ok((select bool_and(r.created_at=t.created_at and r.updated_at>=t.updated_at and r.status_changed_at=t.status_changed_at) from public.flight_requests r join request_times t using(id)),'Client timestamps cannot rewrite history');
select lives_ok($$select pg_temp.request(2)$$,'Selected recipient can have private request');
-- The guarded owner operation must atomically cancel active requests and remove selection.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"18800000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*)::integer from public.flight_requests),2,'Requester sees own records only');
select throws_ok($$insert into public.flight_requests(flight_id,requester_id) values('18810000-0000-4000-8000-000000000001',auth.uid())$$,'42501',null,'Direct request creation closed');
select throws_ok($$update public.flight_requests set status='accepted'$$,'42501',null,'Direct state changes closed');
select throws_ok($$delete from public.flight_requests$$,'42501',null,'Direct history deletion closed');
select set_config('request.jwt.claims','{"sub":"18800000-0000-4000-8000-000000000004","role":"authenticated","user_metadata":{"role":"admin"}}',true);
select is((select count(*)::integer from public.flight_requests),0,'Unrelated admin cannot read requests');
select set_config('request.jwt.claims','{"sub":"18800000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is((select count(*)::integer from public.flight_requests),1,'Other requester cannot enumerate private requests');
select set_config('request.jwt.claims','{"sub":"18800000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(*)::integer from public.flight_requests),3,'Owner reads requests on owned flights');
select lives_ok($$select public.change_flight_recipient('18810000-0000-4000-8000-000000000002','18800000-0000-4000-8000-000000000002',false)$$,'Removal cancels pending request atomically');
select is((select status::text from public.flight_requests where flight_id='18810000-0000-4000-8000-000000000002'),'cancelled','Removed pending request is cancelled');
select lives_ok($$select public.change_flight_recipient('18810000-0000-4000-8000-000000000002','18800000-0000-4000-8000-000000000002',false)$$,'Removal retry remains idempotent');
select set_config('request.jwt.claims','{"sub":"18800000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*)::integer from public.flight_requests),2,'Removed recipient retains own request history');
select is((select count(*)::integer from public.flights where id='18810000-0000-4000-8000-000000000002'),0,'History does not grant live private flight access');
select is((select count(*)::integer from public.flight_requests r join public.flights f on f.id=r.flight_id where f.visibility='PRIVATE'),0,'History join cannot bypass private flight RLS');
reset role;
update public.memberships set status='disabled',disabled_at=now(),disabled_reason='Owned revoke' where user_id='18800000-0000-4000-8000-000000000002';
set local role authenticated;
select is((select count(*)::integer from public.flight_requests),0,'Retained JWT loses history after membership revocation');
select set_config('request.jwt.claims','{"sub":"18800000-0000-4000-8000-000000000007","role":"authenticated"}',true);
select is((select count(*)::integer from public.flight_requests),0,'Auth identity alone grants no request reads');
reset role;
set local role anon;
select throws_ok($$select * from public.flight_requests$$,'42501',null,'Anonymous request reads denied');
reset role;
-- Accepted removal releases derived capacity, including disabled targets.
update public.flights set visibility='PRIVATE' where id='18810000-0000-4000-8000-000000000006';
insert into public.flight_recipients(flight_id,user_id) values
 ('18810000-0000-4000-8000-000000000006','18800000-0000-4000-8000-000000000003'),
 ('18810000-0000-4000-8000-000000000006','18800000-0000-4000-8000-000000000004');
select pg_temp.request(6,3);
select pg_temp.request(6,4);
select pg_temp.transition('accepted',6,3);
update public.memberships set status='disabled',disabled_at=now(),disabled_reason='Owned revoke' where user_id='18800000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"18800000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.change_flight_recipient('18810000-0000-4000-8000-000000000006','18800000-0000-4000-8000-000000000003',false)$$,'Removal cancels accepted request even when target disabled');
select is((select status::text from public.flight_requests where flight_id='18810000-0000-4000-8000-000000000006' and requester_id='18800000-0000-4000-8000-000000000003'),'cancelled','Accepted removal cancels retained record');
reset role;
select lives_ok($$select pg_temp.transition('accepted',6,4)$$,'Accepted removal releases derived capacity');
update public.memberships set status='active',disabled_at=null,disabled_reason=null where user_id='18800000-0000-4000-8000-000000000003';
set local role authenticated;
select lives_ok($$select public.change_flight_recipient('18810000-0000-4000-8000-000000000006','18800000-0000-4000-8000-000000000003',true)$$,'Re-add restores selection');
select is((select status::text from public.flight_requests where flight_id='18810000-0000-4000-8000-000000000006' and requester_id='18800000-0000-4000-8000-000000000003'),'cancelled','Re-add never revives cancelled request');
reset role;
create table public.conversations(fixture_only boolean);
set local role authenticated;
select throws_ok($$select public.change_flight_recipient('18810000-0000-4000-8000-000000000006','18800000-0000-4000-8000-000000000004',false)$$,'55000',null,'Conversation schema still fences unintegrated closure');
select is((select status::text from public.flight_requests where flight_id='18810000-0000-4000-8000-000000000006' and requester_id='18800000-0000-4000-8000-000000000004'),'accepted','Fenced removal leaves request unchanged');
select is((select count(*)::integer from public.flight_recipients where flight_id='18810000-0000-4000-8000-000000000006'),2,'Fenced removal leaves selections unchanged');
reset role;
drop table public.conversations;
update public.memberships set status='disabled',disabled_at=now(),disabled_reason='Owned owner revoke' where user_id='18800000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.request(6,3)$$,'23514',null,'Disabled owner cannot receive new interest');
set local role authenticated;
select is((select count(*)::integer from public.flight_requests),0,'Disabled owner loses request reads');
reset role;
select * from finish();
rollback;
