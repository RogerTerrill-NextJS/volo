begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_function('public','admin_account_deletion_preview',array['uuid'],'Operator impact preview exists');
select has_function('public','admin_begin_account_deletion',array['uuid','uuid','text','uuid'],'Verified deletion entry point exists');
insert into auth.users(id,email) values
 ('22700000-0000-4000-8000-000000000001','admin227@example.invalid'),
 ('22700000-0000-4000-8000-000000000002','target227@example.invalid'),
 ('22700000-0000-4000-8000-000000000003','other227@example.invalid'),
 ('22700000-0000-4000-8000-000000000004','outsider227@example.invalid');
insert into public.memberships(user_id,role) values
 ('22700000-0000-4000-8000-000000000001','admin'),('22700000-0000-4000-8000-000000000002','member'),
 ('22700000-0000-4000-8000-000000000003','member'),('22700000-0000-4000-8000-000000000004','admin');
insert into public.profiles(user_id,display_name,home_airport,pilot_designation) select user_id,'Deletion fixture pilot','KPAO','licensed' from public.memberships where user_id::text like '22700000%';
insert into public.flights(id,owner_id,departure_airport,destination_airport,departure_at,departure_timezone,aircraft_description,pilot_places,visibility) values
 ('22700000-0000-4000-8000-000000000011','22700000-0000-4000-8000-000000000002','KPAO','KSQL',now()+interval '1 day','UTC','Fixture C172',1,'NETWORK'),
 ('22700000-0000-4000-8000-000000000012','22700000-0000-4000-8000-000000000003','KPAO','KSQL',now()+interval '1 day','UTC','Other C172',1,'NETWORK');
insert into public.flight_requests(id,flight_id,requester_id) values
 ('22700000-0000-4000-8000-000000000021','22700000-0000-4000-8000-000000000011','22700000-0000-4000-8000-000000000003'),
 ('22700000-0000-4000-8000-000000000022','22700000-0000-4000-8000-000000000012','22700000-0000-4000-8000-000000000002');
update public.flight_requests set status='accepted' where id::text like '22700000%';
insert into public.conversations(id,flight_request_id,owner_id,requester_id) values
 ('22700000-0000-4000-8000-000000000031','22700000-0000-4000-8000-000000000021','22700000-0000-4000-8000-000000000002','22700000-0000-4000-8000-000000000003');
insert into public.invitations(id,recipient_email,invited_by_user_id,status,auth_user_id) values
 ('22700000-0000-4000-8000-000000000061','target227@example.invalid','22700000-0000-4000-8000-000000000001','issued','22700000-0000-4000-8000-000000000002'),
 ('22700000-0000-4000-8000-000000000062','other227@example.invalid','22700000-0000-4000-8000-000000000002','issued','22700000-0000-4000-8000-000000000003');
insert into public.profile_photo_objects(id,owner_id,source_path,final_path,expected_revision,state,processing_until) values
 ('22700000-0000-4000-8000-000000000071','22700000-0000-4000-8000-000000000002','22700000-0000-4000-8000-000000000002/22700000-0000-4000-8000-000000000071/source','22700000-0000-4000-8000-000000000002/22700000-0000-4000-8000-000000000071.webp',0,'processing',clock_timestamp()+interval '3 minutes');
insert into public.reports(id,reporter_id,target_type,target_id,reason) values
 ('22700000-0000-4000-8000-000000000081','22700000-0000-4000-8000-000000000002','pilot','22700000-0000-4000-8000-000000000003','Target written reason'),
 ('22700000-0000-4000-8000-000000000082','22700000-0000-4000-8000-000000000003','flight','22700000-0000-4000-8000-000000000011','Reason about departing pilot');
select set_config('request.jwt.claims','{"sub":"22700000-0000-4000-8000-000000000002","role":"authenticated"}',true);
insert into public.messages(id,conversation_id,sender_id,body) values('22700000-0000-4000-8000-000000000041','22700000-0000-4000-8000-000000000031','22700000-0000-4000-8000-000000000002','Shared message must survive');
select ok(not has_function_privilege('anon','public.admin_begin_account_deletion(uuid,uuid,text,uuid)','EXECUTE'),'Anonymous cannot execute');
select ok(not has_function_privilege('service_role','public.admin_begin_account_deletion(uuid,uuid,text,uuid)','EXECUTE'),'Service role cannot impersonate operator');
select ok(not has_function_privilege('authenticated','deletion_private.purge_due()','EXECUTE'),'Members cannot run privileged scheduler');
set local role authenticated;
select throws_ok($$select public.admin_begin_account_deletion('22700000-0000-4000-8000-000000000051','22700000-0000-4000-8000-000000000002','verified-reference','22700000-0000-4000-8000-000000000002')$$,'42501',null,'Member cannot verify/execute deletion');
select set_config('request.jwt.claims','{"sub":"22700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.admin_begin_account_deletion('22700000-0000-4000-8000-000000000051','22700000-0000-4000-8000-000000000002','verified-reference','22700000-0000-4000-8000-000000000002')$$,'55000',null,'Default-off retention gate denies execution');
reset role;
update deletion_private.policy set retention_verified=true,evidence_reference='Owned disposable fixture evidence';
set local role authenticated;
select throws_ok($$select public.admin_begin_account_deletion('22700000-0000-4000-8000-000000000051','22700000-0000-4000-8000-000000000001','verified-reference','22700000-0000-4000-8000-000000000001')$$,'42501',null,'Self execution denied');
select throws_ok($$select public.admin_begin_account_deletion('22700000-0000-4000-8000-000000000051','22700000-0000-4000-8000-000000000002','verified-reference','22700000-0000-4000-8000-000000000003')$$,'22023',null,'Exact target confirmation required');
set local timezone='America/Los_Angeles';
select is(public.admin_begin_account_deletion('22700000-0000-4000-8000-000000000051','22700000-0000-4000-8000-000000000002','verified-reference','22700000-0000-4000-8000-000000000002')->>'code','started','Verified operator fences target');
select is(public.admin_begin_account_deletion('22700000-0000-4000-8000-000000000051','22700000-0000-4000-8000-000000000002','verified-reference','22700000-0000-4000-8000-000000000002')->>'code','already_started','Exact retry is stable');
select throws_ok($$select public.admin_begin_account_deletion('22700000-0000-4000-8000-000000000052','22700000-0000-4000-8000-000000000002','verified-reference','22700000-0000-4000-8000-000000000002')$$,'22023',null,'Different request cannot restart target clock');
reset role;
select is((select status::text from public.memberships where user_id='22700000-0000-4000-8000-000000000002'),'disabled','Access denied before external effects');
select ok((select extract(epoch from purge_due_at-verified_at)=5184000 from deletion_private.jobs where id='22700000-0000-4000-8000-000000000051'),'Fixed 60-day deadline');
select throws_ok($$update public.memberships set status='active',disabled_at=null,disabled_reason=null where user_id='22700000-0000-4000-8000-000000000002'$$,'23514',null,'Deletion fence cannot be reactivated');
set local role authenticated;
select is(public.admin_prepare_account_deletion('22700000-0000-4000-8000-000000000051')->>'code','photos','Lifecycle closure reaches photos');
select is(public.admin_prepare_account_deletion('22700000-0000-4000-8000-000000000051')->>'code','photos','Closure retry is a no-op');
select is(public.admin_finish_deletion_photos('22700000-0000-4000-8000-000000000051')->>'code','photos','Photo drain blocks premature parent removal');
select throws_ok($$select public.admin_complete_account_deletion('22700000-0000-4000-8000-000000000051')$$,'55000',null,'Cannot claim live Auth account is deleted');
reset role;
select is((select status::text from public.flights where id='22700000-0000-4000-8000-000000000011'),'cancelled','Owned flight cancelled');
select is((select status::text from public.flights where id='22700000-0000-4000-8000-000000000012'),'open','Other pilot flight preserved');
select is((select status::text from public.flight_requests where id='22700000-0000-4000-8000-000000000021'),'cancelled','Incoming acceptance cancelled');
select is((select status::text from public.flight_requests where id='22700000-0000-4000-8000-000000000022'),'withdrawn','Outgoing acceptance releases capacity');
select ok((select closed_at is not null from public.conversations where id='22700000-0000-4000-8000-000000000031'),'Conversation closed');
update deletion_private.jobs set photo_after=clock_timestamp()-interval '1 second' where id='22700000-0000-4000-8000-000000000051';
set local role authenticated;
select is(public.admin_finish_deletion_photos('22700000-0000-4000-8000-000000000051')->>'code','photos','Unacknowledged photo work retains parent after drain');
reset role;
delete from public.profile_photo_objects where owner_id='22700000-0000-4000-8000-000000000002';
set local role authenticated;
select is(public.admin_finish_deletion_photos('22700000-0000-4000-8000-000000000051')->>'code','auth','Empty drained photo inventory permits profile removal');
reset role;
select ok(not exists(select 1 from public.profiles where user_id='22700000-0000-4000-8000-000000000002'),'Target profile removed');
select ok(exists(select 1 from public.profiles where user_id='22700000-0000-4000-8000-000000000003'),'Other profile preserved');
-- Provider behavior is proved separately with real local Auth; this SQL receipt tests DB gates.
update auth.users set deleted_at=clock_timestamp(),encrypted_password='',email='deleted227@example.invalid' where id='22700000-0000-4000-8000-000000000002';
set local role authenticated;
select is(public.admin_complete_account_deletion('22700000-0000-4000-8000-000000000051')->>'code','retention_pending','Auth readback permits immediate completion');
select set_config('request.jwt.claims','{"sub":"22700000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is((select count(*)::integer from public.messages where id='22700000-0000-4000-8000-000000000041'),1,'Counterpart keeps shared message');
select ok(public.request_has_deleted_pilot('22700000-0000-4000-8000-000000000022'),'Request-only history identifies Deleted pilot');
select ok(public.conversation_has_deleted_pilot('22700000-0000-4000-8000-000000000031'),'Authorized history identifies Deleted pilot');
select set_config('request.jwt.claims','{"sub":"22700000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*)::integer from public.messages where id='22700000-0000-4000-8000-000000000041'),0,'Unrelated admin gets no private history');
select ok(not public.request_has_deleted_pilot('22700000-0000-4000-8000-000000000022'),'Request label does not expose unrelated identities');
select ok(not public.conversation_has_deleted_pilot('22700000-0000-4000-8000-000000000031'),'Label RPC does not expose unrelated identities');
reset role;
select is((select status::text from public.invitations where id='22700000-0000-4000-8000-000000000061'),'revoked','Target live invitation revoked');
select is((select status::text from public.invitations where id='22700000-0000-4000-8000-000000000062'),'issued','Another recipient invitation stays live');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"22700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.admin_account_deletion_preview('22700000-0000-4000-8000-000000000003')->>'retentionDays','60','Preview gives approved retention impact');
reset role;
select is(deletion_private.purge_due(),0,'No premature retention purge');
update deletion_private.jobs set verified_at=statement_timestamp()-interval '1440 hours',purge_due_at=statement_timestamp() where id='22700000-0000-4000-8000-000000000051';
select is(deletion_private.purge_due(),1,'Due retention purge executes');
select ok((select reference is null and subject_email is null and verified_by is null and phase='purged' from deletion_private.jobs where id='22700000-0000-4000-8000-000000000051'),'Execution personal payload removed at deadline');
select isnt((select recipient_email from public.invitations where id='22700000-0000-4000-8000-000000000061'),'target227@example.invalid','Target invitation email minimized');
select is((select recipient_email from public.invitations where id='22700000-0000-4000-8000-000000000062'),'other227@example.invalid','Other recipient email preserved');
select is((select reason from public.reports where id='22700000-0000-4000-8000-000000000081'),'Retention period ended','Report about another pilot survives with reason minimized');
select is((select reason from public.reports where id='22700000-0000-4000-8000-000000000082'),'Retention period ended','Other reporter record survives with reason minimized');
select is(deletion_private.purge_due(),0,'Retention purge retry is stable');
select ok(exists(select 1 from public.messages where id='22700000-0000-4000-8000-000000000041'),'Shared history survives retention purge');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"22700000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select public.submit_report('22700000-0000-4000-8000-000000000083','message','22700000-0000-4000-8000-000000000041','Late personal reason must not persist');
select is((select reason from public.reports where id='22700000-0000-4000-8000-000000000083'),'Retention period ended','Late reports cannot recreate expired personal payload');
select is(public.submit_report('22700000-0000-4000-8000-000000000083','message','22700000-0000-4000-8000-000000000041','Late personal reason must not persist')->>'code','already_reported','Post-retention report retry remains stable');
reset role;
update public.memberships set status='disabled',disabled_at=clock_timestamp(),disabled_reason='Owned fixture' where user_id='22700000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"22700000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.admin_begin_account_deletion('22700000-0000-4000-8000-000000000052','22700000-0000-4000-8000-000000000004','Verified disabled admin request','22700000-0000-4000-8000-000000000004')->>'code','started','Another active admin can execute an already-disabled administrator deletion');
reset role;
update deletion_private.jobs set verified_at=statement_timestamp()-interval '1440 hours',purge_due_at=statement_timestamp() where id='22700000-0000-4000-8000-000000000052';
select is(deletion_private.purge_due(),1,'Incomplete overdue job minimizes its temporary payload');
set local role authenticated;
select is(public.admin_account_deletion_status('22700000-0000-4000-8000-000000000052')->>'overdue','true','Incomplete work remains visibly overdue after payload minimization');
select is(public.admin_prepare_account_deletion('22700000-0000-4000-8000-000000000052')->>'code','photos','Overdue job can resume external cleanup');
reset role;
update deletion_private.jobs set photo_after=clock_timestamp()-interval '1 second' where id='22700000-0000-4000-8000-000000000052';
set local role authenticated;
select is(public.admin_finish_deletion_photos('22700000-0000-4000-8000-000000000052')->>'code','auth','Overdue job retains phase progression');
reset role;
update auth.users set deleted_at=clock_timestamp(),encrypted_password='',email=null where id='22700000-0000-4000-8000-000000000004';
set local role authenticated;
select is(public.admin_complete_account_deletion('22700000-0000-4000-8000-000000000052')->>'code','purged','Late Auth confirmation needs no expired email payload and preserves completed retention');
reset role;
select * from finish();
rollback;
