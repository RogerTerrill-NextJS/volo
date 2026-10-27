begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_function('public','admin_mvp_metrics',array[]::text[],'One no-argument aggregate query exists');
insert into auth.users(id,email) select ('22300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'metrics-'||n||'@example.invalid' from generate_series(1,5)n;
-- Capture existing data through the real authorized report. CI also runs this
-- contract with fictional seeds; only this fixture's exact contribution changes.
insert into public.memberships(user_id,role) values('22300000-0000-4000-8000-000000000001','admin');
create function pg_temp.actor(n integer) returns text language sql as $$select set_config('request.jwt.claims',json_build_object('sub',('22300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'role','authenticated','user_metadata',json_build_object('role','admin'))::text,true);$$;
set local role authenticated;
select pg_temp.actor(1);
create temporary table metrics_baseline as select public.admin_mvp_metrics() report;
create function pg_temp.expected(metric text,increment bigint) returns text language sql as $$select ((report->>metric)::bigint+increment)::text from metrics_baseline;$$;
reset role;
insert into public.memberships(user_id,role) select id,case when email in ('metrics-1@example.invalid','metrics-5@example.invalid') then 'admin' else 'member' end::public.member_role from auth.users where email like 'metrics-%@example.invalid' and email not in ('metrics-1@example.invalid','metrics-4@example.invalid');
update public.memberships set status='disabled',disabled_at=now(),disabled_reason='Owned fixture' where user_id='22300000-0000-4000-8000-000000000003';
insert into public.profiles(user_id,display_name,home_airport,pilot_designation) values('22300000-0000-4000-8000-000000000002','Private metrics profile canary','KPAO','licensed'),('22300000-0000-4000-8000-000000000003','Disabled profile canary','KSQL','licensed');
insert into public.invitations(id,recipient_email,invited_by_user_id,status,revoked_at,revoked_by_user_id,revocation_reason) values('22310000-0000-4000-8000-000000000001','Repeat@example.invalid','22300000-0000-4000-8000-000000000001','revoked',now(),'22300000-0000-4000-8000-000000000001','Owned fixture');
insert into public.invitations(id,recipient_email,invited_by_user_id) values('22310000-0000-4000-8000-000000000002','repeat@example.invalid','22300000-0000-4000-8000-000000000001'),('22310000-0000-4000-8000-000000000003','Failed@example.invalid','22300000-0000-4000-8000-000000000001');
insert into public.invitations(id,recipient_email,invited_by_user_id,status,auth_user_id,verified_user_id,verified_at,setup_authorization_id,password_established_at,redeemed_at) values('22310000-0000-4000-8000-000000000004','metrics-2@example.invalid','22300000-0000-4000-8000-000000000001','redeemed','22300000-0000-4000-8000-000000000002','22300000-0000-4000-8000-000000000002',now(),gen_random_uuid(),now(),now());
insert into public.invitation_send_attempts(id,invitation_id,invitation_version,requested_by_user_id,kind,outcome,completed_at,reconciled_outcome,reconciled_at) select gen_random_uuid(),('22310000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,1,'22300000-0000-4000-8000-000000000001','initial',case when n=3 then 'rejected' when n=2 then 'unknown' else 'accepted' end::public.invitation_send_outcome,now(),case when n=2 then 'accepted'::public.invitation_send_resolution else null end,case when n=2 then now() else null end from generate_series(1,4)n;
set local role authenticated;
select pg_temp.actor(1);
select is(public.admin_mvp_metrics()->>'invitedPilots',pg_temp.expected('invitedPilots',2),'Receipt/reconciliation and repeated recipient deduplicate, failed send excluded');
select is(public.admin_mvp_metrics()->>'activatedPilots',pg_temp.expected('activatedPilots',1),'Activation uses redeemed invitation subject, not all admitted members');
select is(public.admin_mvp_metrics()->>'activeMembers',pg_temp.expected('activeMembers',2),'Active membership excludes disabled users');
select is(public.admin_mvp_metrics()->>'completedProfiles',pg_temp.expected('completedProfiles',2),'Persisted required profiles include disabled history');
select is(public.admin_mvp_metrics()->>'activeProfiles',pg_temp.expected('activeProfiles',1),'Active profiles exclude disabled members');
select is(public.admin_mvp_metrics()->>'flightPosts',pg_temp.expected('flightPosts',0),'Before posting, existing post count is unchanged');
select is(public.admin_mvp_metrics()->>'outcomes','participant_reported','Participant outcomes are separate from acceptance');
reset role;
insert into public.flights(id,owner_id,departure_airport,destination_airport,departure_at,departure_timezone,aircraft_description,pilot_places,visibility,notes) values('22320000-0000-4000-8000-000000000001','22300000-0000-4000-8000-000000000001','KPAO','KSQL',now()+interval '2 days','UTC','Private aircraft canary',1,'PRIVATE','Private flight canary');
insert into public.flight_recipients(flight_id,user_id) values('22320000-0000-4000-8000-000000000001','22300000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.actor(2);
select public.submit_flight_interest('22320000-0000-4000-8000-000000000001','Private intro canary');
reset role;
create temporary table source as select id from public.flight_requests where flight_id='22320000-0000-4000-8000-000000000001';
grant select on source to authenticated;
set local role authenticated;
select pg_temp.actor(1);
select public.decide_flight_request('22320000-0000-4000-8000-000000000001',(select id from source),'accepted');
select is(public.admin_mvp_metrics()->>'currentAcceptedRequests',pg_temp.expected('currentAcceptedRequests',1),'Current acceptance counted');
select pg_temp.actor(2);
create temporary table thread as select public.get_or_create_flight_conversation((select id from source)) id;
select public.send_conversation_message((select id from thread),'22350000-0000-4000-8000-000000000001','Private message canary');
select public.send_conversation_message((select id from thread),'22350000-0000-4000-8000-000000000001','Private message canary');
select public.withdraw_flight_request('22320000-0000-4000-8000-000000000001',(select id from source));
select public.submit_flight_interest('22320000-0000-4000-8000-000000000001');
select pg_temp.actor(1);
select is(public.admin_mvp_metrics()->>'currentAcceptedRequests',pg_temp.expected('currentAcceptedRequests',0),'Withdrawal/resubmission removes current acceptance');
select is(public.admin_mvp_metrics()->>'recordedAcceptedRequests',pg_temp.expected('recordedAcceptedRequests',1),'Acceptance evidence retained after withdrawal');
select public.decide_flight_request('22320000-0000-4000-8000-000000000001',(select id from source),'accepted');
select is(public.admin_mvp_metrics()->>'recordedAcceptedRequests',pg_temp.expected('recordedAcceptedRequests',1),'Reacceptance counts unique request, not repeated event');
select is(public.admin_mvp_metrics()->>'interestRequests',pg_temp.expected('interestRequests',1),'Resubmission counts one retained request');
select is(public.admin_mvp_metrics()->>'flightPosts',pg_temp.expected('flightPosts',1),'Private post contributes aggregate count');
select is(public.admin_mvp_metrics()->>'messages',pg_temp.expected('messages',1),'Exact message retry counted once');
select is(public.admin_mvp_metrics()->>'messagingConversations',pg_temp.expected('messagingConversations',1),'Messaging counts distinct conversations with messages');
-- VOLO-230: acceptance and even real messaging do not establish a flight.
select is(public.admin_mvp_metrics()->>'outcomeResponses',pg_temp.expected('outcomeResponses',0),'Acceptance/message activity adds no outcome responses');
select is(public.admin_mvp_metrics()->>'confirmedConnections',pg_temp.expected('confirmedConnections',0),'Acceptance/message activity adds no confirmed connection');
-- A second flight with the same two pilots is a distinct accepted connection.
reset role;
insert into public.flights(id,owner_id,departure_airport,destination_airport,departure_at,departure_timezone,aircraft_description,pilot_places,visibility) values('22320000-0000-4000-8000-000000000002','22300000-0000-4000-8000-000000000001','KPAO','KSQL',now()+interval '2 days','UTC','Second private aircraft canary',1,'PRIVATE');
insert into public.flight_recipients(flight_id,user_id) values('22320000-0000-4000-8000-000000000002','22300000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.actor(2);
select public.submit_flight_interest('22320000-0000-4000-8000-000000000002');
reset role;
create temporary table second_source as select id from public.flight_requests where flight_id='22320000-0000-4000-8000-000000000002';
grant select on second_source to authenticated;
set local role authenticated;
select pg_temp.actor(1);
select public.decide_flight_request('22320000-0000-4000-8000-000000000002',(select id from second_source),'accepted');
-- Simulate elapsed time only on these exact owned fixture flights. Restore the
-- material-edit guard before every authenticated outcome operation.
reset role;
alter table public.flights disable trigger flights_prepare;
update public.flights set departure_at=now()-interval '2 days',departure_local_date=(now()-interval '2 days')::date where id in('22320000-0000-4000-8000-000000000001','22320000-0000-4000-8000-000000000002');
alter table public.flights enable trigger flights_prepare;
set local role authenticated;
select pg_temp.actor(1);
select is(public.admin_mvp_metrics()->>'confirmedConnections',pg_temp.expected('confirmedConnections',0),'Passing flight dates still does not infer flying');
select public.save_flight_outcome((select id from source),true,0);
select is(public.admin_mvp_metrics()->>'outcomeResponses',pg_temp.expected('outcomeResponses',1),'One participant response is counted');
select is(public.admin_mvp_metrics()->>'confirmedConnections',pg_temp.expected('confirmedConnections',1),'One Yes confirms one reported connection');
select is(public.admin_mvp_metrics()->>'oneParticipantConfirmed',pg_temp.expected('oneParticipantConfirmed',1),'Other participant unanswered remains exactly one Yes');
select is(public.admin_mvp_metrics()->>'bothParticipantsConfirmed',pg_temp.expected('bothParticipantsConfirmed',0),'Unanswered is not a second confirmation');
create temporary table first_outcome as select public.get_flight_outcome((select id from source)) value;
select public.save_flight_outcome((select id from source),true,0);
select is(public.get_flight_outcome((select id from source)),(select value from first_outcome),'Identical outcome retry preserves receipt and timestamp');
select pg_temp.actor(2);
select public.save_flight_outcome((select id from source),false,0);
select pg_temp.actor(1);
select is(public.admin_mvp_metrics()->>'outcomeResponses',pg_temp.expected('outcomeResponses',2),'Yes and No count as two responses');
select is(public.admin_mvp_metrics()->>'confirmedConnections',pg_temp.expected('confirmedConnections',1),'Conflicting pair still has exactly one reported connection');
select is(public.admin_mvp_metrics()->>'conflictingConnections',pg_temp.expected('conflictingConnections',1),'Conflicting Yes/No is explicit');
select pg_temp.actor(2);
select public.save_flight_outcome((select id from source),true,1);
select pg_temp.actor(1);
select is(public.admin_mvp_metrics()->>'outcomeResponses',pg_temp.expected('outcomeResponses',2),'Correction does not add a response row');
select is(public.admin_mvp_metrics()->>'bothParticipantsConfirmed',pg_temp.expected('bothParticipantsConfirmed',1),'Corrected pair has both Yes');
select is(public.admin_mvp_metrics()->>'oneParticipantConfirmed',pg_temp.expected('oneParticipantConfirmed',0),'Both Yes is not exactly one Yes');
select is(public.admin_mvp_metrics()->>'conflictingConnections',pg_temp.expected('conflictingConnections',0),'Correction clears conflicting aggregate');
select public.save_flight_outcome((select id from second_source),true,0);
select is(public.admin_mvp_metrics()->>'confirmedConnections',pg_temp.expected('confirmedConnections',2),'Same pilot pair on two accepted requests counts two connections');
select is(public.admin_mvp_metrics()->>'outcomeResponses',pg_temp.expected('outcomeResponses',3),'Three latest responses across two requests counted once each');
-- Check every numeric field together through the real no-argument report. The
-- baseline contains seeds or pre-existing records, never assumes an empty DB.
select is(public.admin_mvp_metrics()-'asOf',jsonb_build_object('outcomes','participant_reported') || (
 select jsonb_object_agg(metric,(pg_temp.expected(metric,delta))::bigint) from (values
 ('invitedPilots',2),('activatedPilots',1),('activeMembers',2),('completedProfiles',2),('activeProfiles',1),
 ('flightPosts',2),('interestRequests',2),('currentAcceptedRequests',2),('recordedAcceptedRequests',2),
 ('messages',1),('messagingConversations',1),('outcomeResponses',3),('confirmedConnections',2),
 ('oneParticipantConfirmed',1),('bothParticipantsConfirmed',1),('conflictingConnections',0)
 ) expected(metric,delta)
),'Full invitation-to-outcome report matches the representative source population');
select ok(public.admin_mvp_metrics()::text !~ 'canary|example.invalid|22300000|22320000|22350000','Only aggregate metadata, no profiles/emails/IDs/notes/message bodies');
select is((select count(*)::integer from public.messages),1,'Admin aggregate does not broaden private message row access');
-- Current actor is owner/participant above; unrelated admin must still see zero raw rows.
select pg_temp.actor(5);
select is((select count(*)::integer from public.messages),0,'Unrelated admin gains no raw conversation access');
select is(public.admin_mvp_metrics()->>'messages',pg_temp.expected('messages',1),'Unrelated active admin receives only global count');
select pg_temp.actor(2);
select throws_ok($$select public.admin_mvp_metrics()$$,'42501',null,'Member with forged metadata denied');
select pg_temp.actor(3);
select throws_ok($$select public.admin_mvp_metrics()$$,'42501',null,'Disabled member denied');
select pg_temp.actor(4);
select throws_ok($$select public.admin_mvp_metrics()$$,'42501',null,'Unadmitted identity denied');
reset role;
update public.memberships set role='member' where user_id='22300000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.actor(1);
select throws_ok($$select public.admin_mvp_metrics()$$,'42501',null,'Demoted admin retained session denied');
reset role;
set local role anon;
select throws_ok($$select public.admin_mvp_metrics()$$,'42501',null,'Anonymous invocation closed');
reset role;
set local role service_role;
select throws_ok($$select public.admin_mvp_metrics()$$,'42501',null,'Service-role bypass closed');
reset role;
select * from finish();
rollback;
