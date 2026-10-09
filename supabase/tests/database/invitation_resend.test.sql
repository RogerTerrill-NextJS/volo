begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000001','resend-original@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000002','resend-admin@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000003','resend-member@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000004','resend-disabled@example.invalid',now()),
 ('20000000-0000-4000-8000-000000000001','Resume+tag@example.invalid',null);
insert into public.memberships(user_id,role,status,disabled_at,disabled_reason) values
 ('10000000-0000-4000-8000-000000000001','admin','active',null,null),
 ('10000000-0000-4000-8000-000000000002','admin','active',null,null),
 ('10000000-0000-4000-8000-000000000003','member','active',null,null),
 ('10000000-0000-4000-8000-000000000004','admin','disabled',now(),'Test');
create temporary table memberships_before as select * from public.memberships;
insert into public.invitations(id,recipient_email,invited_by_user_id,auth_user_id,status,created_at,verified_user_id,verified_at,setup_authorization_id,password_established_at)
 values ('30000000-0000-4000-8000-000000000001','RESUME+tag@example.invalid','10000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000001','password_established','2000-01-01',
 '20000000-0000-4000-8000-000000000001',now(),'50000000-0000-4000-8000-000000000001',now());
insert into public.invitation_send_attempts(id,invitation_id,invitation_version,requested_by_user_id,kind,outcome,completed_at)
 values ('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1,'10000000-0000-4000-8000-000000000001','initial','accepted',now());
create function pg_temp.reserve(n integer,v bigint,admin integer default 2) returns jsonb language sql as $$
 select public.reserve_invitation_resend(('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '30000000-0000-4000-8000-000000000001',v,('10000000-0000-4000-8000-'||lpad(admin::text,12,'0'))::uuid);
$$;
create function pg_temp.prepare(n integer,v bigint,digest text default repeat('a',64),transport text default 'invite',admin integer default 2) returns jsonb language sql as $$
 select public.prepare_invitation_send_proof(('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,v,
 ('10000000-0000-4000-8000-'||lpad(admin::text,12,'0'))::uuid,'20000000-0000-4000-8000-000000000001',digest,transport);
$$;
create function pg_temp.record(n integer,v bigint,result text,err text default null) returns jsonb language sql as $$
 select public.record_invitation_send_outcome(('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,v,result,
 '20000000-0000-4000-8000-000000000001',err);
$$;
create function pg_temp.consume(n integer,v bigint,digest text default repeat('a',64),transport text default 'invite') returns jsonb language sql as $$
 select public.consume_invitation_send_proof(('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,v,
 '20000000-0000-4000-8000-000000000001',digest,transport);
$$;
create function pg_temp.reconcile(n integer,v bigint,result text,admin integer default 2) returns jsonb language sql as $$
 select public.reconcile_invitation_send(('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,v,
 ('10000000-0000-4000-8000-'||lpad(admin::text,12,'0'))::uuid,result,'20000000-0000-4000-8000-000000000001');
$$;
select is(pg_temp.reserve(1,1,3)->>'code','denied','Member cannot resend');
select is(pg_temp.reserve(1,1,4)->>'code','denied','Disabled admin cannot resend');
select is(pg_temp.reserve(1,null)->>'code','invalid_input','Null version rejected');
select is(pg_temp.reserve(1,0)->>'code','invalid_input','Nonpositive version rejected');
select is(pg_temp.reserve(1,2)->>'code','stale','Wrong generation rejected');
update auth.users set email='wrong@example.invalid' where id='20000000-0000-4000-8000-000000000001';
select is(pg_temp.reserve(1,1)->>'code','conflict','Changed provider email protected');
update auth.users set email='Resume+tag@example.invalid',banned_until=now()+interval '1 day' where id='20000000-0000-4000-8000-000000000001';
select is(pg_temp.reserve(1,1)->>'code','conflict','Banned subject protected');
update auth.users set banned_until=null where id='20000000-0000-4000-8000-000000000001';
insert into public.memberships(user_id) values ('20000000-0000-4000-8000-000000000001');
select is(pg_temp.reserve(1,1)->>'code','conflict','Existing membership protected');
delete from public.memberships where user_id='20000000-0000-4000-8000-000000000001';
select is((pg_temp.reserve(1,1)->>'version')::bigint,2::bigint,'Old invitation advances once');
select is(pg_temp.reserve(1,1)->>'fresh','false','Operation replay cannot send');
select is(pg_temp.reserve(1,2)->>'code','conflict','Changed replay input conflicts');
select is(pg_temp.reserve(2,1)->>'code','stale','Competing expected generation loses');
select is(pg_temp.reserve(2,2)->>'code','pending_reconciliation','Started generation blocks another send');
select ok((select version=2 and status='pending_issuance' and auth_user_id='20000000-0000-4000-8000-000000000001'
 and invited_by_user_id='10000000-0000-4000-8000-000000000001' and verified_user_id is null and verified_at is null
 and setup_authorization_id is null and password_established_at is null from public.invitations where id='30000000-0000-4000-8000-000000000001'),'Resend retains ownership and clears setup');
select is(pg_temp.prepare(1,2,repeat('a',64),'invite',3)->>'code','denied','Proof preparation requires requesting admin');
select is(pg_temp.prepare(1,2,'raw-secret')->>'code','conflict','Only digest accepted');
select is(pg_temp.prepare(1,2)->>'code','prepared','Proof committed before send');
select is(pg_temp.prepare(1,2)->>'code','prepared','Identical preparation harmless');
select is(pg_temp.prepare(1,2,repeat('b',64))->>'code','conflict','Proof cannot be replaced');
select is(pg_temp.prepare(1,2,null)->>'code','conflict','Null digest denied');
select is(pg_temp.prepare(1,2,repeat('a',64),null)->>'code','conflict','Null transport denied');
select is(pg_temp.consume(1,2)->>'code','stale','Pending generation cannot authorize setup');
select is(pg_temp.record(1,2,'accepted')->>'code','recorded','Resend accepts retained subject');
select is(pg_temp.consume(1,2,repeat('b',64))->>'code','conflict','Wrong proof denied');
select is(pg_temp.consume(1,2,repeat('a',64),'recovery')->>'code','conflict','Wrong transport denied');
select is(public.consume_invitation_send_proof('40000000-0000-4000-8000-000000000001',2,null,repeat('a',64),'invite')->>'code','conflict','Null subject denied');
update auth.users set banned_until=now()+interval '1 day' where id='20000000-0000-4000-8000-000000000001';
select is(pg_temp.consume(1,2)->>'code','conflict','Banned subject cannot consume proof');
update auth.users set banned_until=null where id='20000000-0000-4000-8000-000000000001';
select is(pg_temp.consume(1,2)->>'code','consumed','Current proof consumed once');
select is(pg_temp.consume(1,2)->>'code','conflict','Proof replay denied');
select is(pg_temp.reserve(2,2)->>'code','reserved','Next resend permitted after acceptance');
select is(pg_temp.consume(1,2)->>'code','stale','Old proof fenced after resend');
update auth.users set email_confirmed_at=now() where id='20000000-0000-4000-8000-000000000001';
select is(pg_temp.prepare(2,3,repeat('b',64),'recovery')->>'code','prepared','Confirmed transport can prepare');
select is(pg_temp.record(2,3,'unknown','timeout')->>'code','recorded','Ambiguity retained');
select is(pg_temp.reserve(3,3)->>'code','pending_reconciliation','Unknown generation blocks resend');
select is(pg_temp.reconcile(2,3,'accepted',3)->>'code','denied','Member cannot reconcile');
select is(pg_temp.reconcile(2,3,'unknown')->>'code','conflict','Uncertain resolution not accepted');
select is(pg_temp.reconcile(2,3,'accepted')->>'code','reconciled','Trusted acceptance resolves unknown');
select is(pg_temp.reconcile(2,3,'accepted')->>'code','reconciled','Resolution replay harmless');
select is(pg_temp.reconcile(2,3,'rejected')->>'code','conflict','Resolution immutable');
select is(pg_temp.record(2,3,'rejected','provider_rejected')->>'code','conflict','Contradictory late result denied');
select ok((select outcome='unknown' and reconciled_outcome='accepted' and reconciled_at is not null
 from public.invitation_send_attempts where id='40000000-0000-4000-8000-000000000002'),'Original outcome preserved with resolution');
select is(pg_temp.reserve(3,3)->>'code','reserved','Resolved generation permits one resend');
select is(pg_temp.prepare(3,4,repeat('a',64),'recovery')->>'code','prepared','Prepare terminal race');
update public.invitations set status='revoked',revoked_at=now(),revoked_by_user_id='10000000-0000-4000-8000-000000000001',revocation_reason='Test' where id='30000000-0000-4000-8000-000000000001';
select is(pg_temp.reconcile(3,4,'accepted')->>'code','stale','Terminal acceptance records history only');
select is(pg_temp.consume(3,4)->>'code','stale','Terminal proof denied');
select is(pg_temp.reserve(4,4)->>'code','stale','Terminal resend denied');
select is((select status::text from public.invitations where id='30000000-0000-4000-8000-000000000001'),'revoked','Late outcome cannot restore eligibility');
select is(public.reserve_invitation_send('20000000-0000-4000-8000-000000000002','reconcile-owned@example.invalid','10000000-0000-4000-8000-000000000001')->>'code','reserved','Reserve initial creation with lost response');
insert into auth.users(id,email) values ('20000000-0000-4000-8000-000000000002','RECONCILE-OWNED@example.invalid');
select is(public.record_invitation_send_outcome('20000000-0000-4000-8000-000000000002',1,'unknown',null,'timeout')->>'code','recorded','Initial unknown durable before binding');
select is(public.reconcile_invitation_send('20000000-0000-4000-8000-000000000002',1,'10000000-0000-4000-8000-000000000002','accepted','20000000-0000-4000-8000-000000000001')->>'code','conflict','Initial reconciliation cannot adopt another subject');
select is(public.reconcile_invitation_send('20000000-0000-4000-8000-000000000002',1,'10000000-0000-4000-8000-000000000002','accepted','20000000-0000-4000-8000-000000000002')->>'code','reconciled','Trusted initial response binds only reserved UUID');
select results_eq('select * from public.memberships order by user_id','select * from memberships_before order by user_id','No membership mutation');
select ok(not has_table_privilege(role,'public.invitation_send_proofs',privilege),role||' proof access denied')
 from (values ('anon'),('authenticated')) r(role) cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) p(privilege);
select ok(not has_function_privilege(role,signature,'EXECUTE'),role||' cannot execute '||signature)
 from (values ('anon'),('authenticated')) r(role) cross join (values
 ('public.reserve_invitation_resend(uuid,uuid,bigint,uuid)'),
 ('public.prepare_invitation_send_proof(uuid,bigint,uuid,uuid,text,text)'),
 ('public.consume_invitation_send_proof(uuid,bigint,uuid,text,text)'),
 ('public.reconcile_invitation_send(uuid,bigint,uuid,text,uuid)')) f(signature);
select ok(has_function_privilege('service_role',signature,'EXECUTE'),'Service role can execute '||signature)
 from (values ('public.reserve_invitation_resend(uuid,uuid,bigint,uuid)'),
 ('public.prepare_invitation_send_proof(uuid,bigint,uuid,uuid,text,text)'),
 ('public.consume_invitation_send_proof(uuid,bigint,uuid,text,text)'),
 ('public.reconcile_invitation_send(uuid,bigint,uuid,text,uuid)')) f(signature);
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
 lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
 where n.nspname='public' and p.proname in ('reserve_invitation_resend','prepare_invitation_send_proof','consume_invitation_send_proof','reconcile_invitation_send')
 and acl.grantee=0 and acl.privilege_type='EXECUTE'),'PUBLIC execution revoked');
select * from finish();
rollback;
