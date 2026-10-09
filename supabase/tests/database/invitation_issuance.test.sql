begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000001','issuance-admin@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000002','issuance-member@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000003','issuance-disabled@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000004','issuance-unconfirmed@example.invalid',null);
insert into public.memberships(user_id,role,status,disabled_at,disabled_reason) values
 ('10000000-0000-4000-8000-000000000001','admin','active',null,null),
 ('10000000-0000-4000-8000-000000000002','member','active',null,null),
 ('10000000-0000-4000-8000-000000000003','admin','disabled',now(),'Test');
create temporary table memberships_before as select * from public.memberships;
create function pg_temp.reserve(n integer,email text default ' New+tag@Example.invalid ',requester integer default 1)
returns jsonb language sql as $$
 select public.reserve_invitation_send(('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,email,
 ('10000000-0000-4000-8000-'||lpad(requester::text,12,'0'))::uuid);
$$;
create function pg_temp.bind(n integer,version bigint default 1,requester integer default 1,subject integer default null)
returns jsonb language sql as $$
 select public.bind_invitation_send_subject(('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,version,
 ('10000000-0000-4000-8000-'||lpad(requester::text,12,'0'))::uuid,
 ('20000000-0000-4000-8000-'||lpad(coalesce(subject,n)::text,12,'0'))::uuid);
$$;
create function pg_temp.record(n integer,outcome text,version bigint default 1,subject integer default null,err text default null)
returns jsonb language sql as $$
 select public.record_invitation_send_outcome(('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,version,outcome,
 case when subject is not null then ('20000000-0000-4000-8000-'||lpad(subject::text,12,'0'))::uuid end,err);
$$;
select is(pg_temp.reserve(1)->>'code','reserved','Reservation succeeds');
select is((pg_temp.reserve(1)->>'fresh')::boolean,false,'Repeated operation cannot send again');
select is(pg_temp.reserve(1,'NEW+TAG@example.INVALID')->>'code','reserved','Normalized replay matches');
select is(pg_temp.reserve(1,'another@example.invalid')->>'code','conflict','Changed input conflicts');
select is(pg_temp.reserve(1,'new+tag@example.invalid',2)->>'code','denied','Member requester denied');
select is(pg_temp.reserve(2,'NEW+TAG@example.invalid')->>'code','conflict','Another operation cannot own live email');
select is(pg_temp.reserve(2,'issuance-admin@example.invalid')->>'code','conflict','Confirmed account protected');
select is(pg_temp.reserve(2,'ISSUANCE-UNCONFIRMED@example.invalid')->>'code','conflict','Unconfirmed account protected');
select is(pg_temp.reserve(2,'issuance-disabled@example.invalid')->>'code','conflict','Disabled account protected');
select is(pg_temp.reserve(2,'other@example.invalid',3)->>'code','denied','Disabled admin denied');
select is(pg_temp.reserve(2,'other@example.invalid',4)->>'code','denied','Absent membership denied');
select is(pg_temp.reserve(2,'no-at-sign')->>'code','invalid_input','Malformed address rejected');
select is(pg_temp.reserve(2,'café@example.invalid')->>'code','invalid_input','Non ASCII rejected');
select is(public.reserve_invitation_send(null,'x@example.invalid','10000000-0000-4000-8000-000000000001')->>'code','invalid_input','Null operation rejected');
select is(pg_temp.record(1,'accepted',1,1)->>'code','conflict','Acceptance needs durable binding');
select is(pg_temp.bind(1)->>'code','conflict','Missing Auth subject rejected');
insert into auth.users(id,email) values ('20000000-0000-4000-8000-000000000001','new+tag@example.invalid');
select is(pg_temp.reserve(1)->>'code','reserved','Owned account does not break replay');
select is(pg_temp.bind(1,2)->>'code','stale','Version fenced');
select is(pg_temp.bind(1,1,2)->>'code','denied','Binding requires admin');
select is(pg_temp.bind(1,1,1,2)->>'code','conflict','Subject must be operation UUID');
update auth.users set email='wrong@example.invalid' where id='20000000-0000-4000-8000-000000000001';
select is(pg_temp.bind(1)->>'code','conflict','Auth email must match');
update auth.users set email='NEW+TAG@example.invalid' where id='20000000-0000-4000-8000-000000000001';
insert into public.memberships(user_id) values ('20000000-0000-4000-8000-000000000001');
select is(pg_temp.bind(1)->>'code','conflict','Existing membership cannot be invited');
delete from public.memberships where user_id='20000000-0000-4000-8000-000000000001';
select is(pg_temp.bind(1)->>'code','bound','Owned new subject bound');
select is(pg_temp.bind(1)->>'code','bound','Identical binding harmless');
select is((select status::text from public.invitations where recipient_email_key='new+tag@example.invalid'),'pending_issuance','Binding does not issue');
select is(pg_temp.record(1,'accepted',1,2)->>'code','conflict','Wrong observed subject denied');
select is(pg_temp.record(1,'accepted',2,1)->>'code','conflict','Wrong attempt version denied');
select is(pg_temp.record(1,'accepted',1,1)->>'code','recorded','Matching acceptance recorded');
select is((select status::text from public.invitations where recipient_email_key='new+tag@example.invalid'),'issued','Acceptance advances matching generation');
select is(pg_temp.record(1,'accepted',1,1)->>'code','recorded','Outcome replay harmless');
select is(pg_temp.record(1,'unknown',1,null,'timeout')->>'code','conflict','First outcome immutable');
select is(pg_temp.reserve(3,'new.tag@example.invalid')->>'code','reserved','Dot variant distinct');
select is(pg_temp.reserve(4,'new+other@example.invalid')->>'code','reserved','Plus variant distinct');
select is(pg_temp.record(3,'unknown',1,null,'timeout')->>'code','recorded','Unknown recorded');
select is((pg_temp.reserve(3,'new.tag@example.invalid')->>'fresh')::boolean,false,'Unknown replay blocked');
select is(pg_temp.reserve(5,'new.tag@example.invalid')->>'code','conflict','Unknown reserves address');
select is(pg_temp.record(4,'rejected',1,null,'identity_conflict')->>'code','recorded','Rejected recorded');
select is(pg_temp.record(4,'rejected',1,null,'provider_rejected')->>'code','conflict','First error preserved');
select is(pg_temp.record(4,'unknown',1,null,'raw-private-error')->>'code','conflict','Raw errors forbidden');
select is(pg_temp.reserve(5,'old@example.invalid')->>'code','reserved','New initial reservation');
update public.invitations set created_at='2000-01-01',updated_at='2000-01-01' where recipient_email_key='old@example.invalid';
insert into auth.users(id,email) values ('20000000-0000-4000-8000-000000000005','old@example.invalid');
select is(pg_temp.bind(5)->>'code','bound','Age does not block binding');
update public.invitations set status='revoked',revoked_at=now(),revoked_by_user_id='10000000-0000-4000-8000-000000000001',revocation_reason='Test' where recipient_email_key='old@example.invalid';
select is(pg_temp.bind(5)->>'code','stale','Terminal binding denied');
select is(pg_temp.record(5,'accepted',1,5)->>'code','stale','Late result only records history');
select is((select status::text from public.invitations where recipient_email_key='old@example.invalid'),'revoked','Terminal state retained');
select is((select outcome::text from public.invitation_send_attempts where id='20000000-0000-4000-8000-000000000005'),'accepted','Late acceptance retained as evidence');
select is(pg_temp.reserve(6,'later@example.invalid')->>'code','reserved','Reservation for permission loss');
update public.memberships set role='member' where user_id='10000000-0000-4000-8000-000000000001';
select is(pg_temp.bind(6)->>'code','denied','Permission loss after reservation denied');
select is(pg_temp.record(6,'rejected',1,null,'provider_rejected')->>'code','recorded','History after permission loss permitted');
update public.memberships set role='admin' where user_id='10000000-0000-4000-8000-000000000001';
select results_eq('select * from public.memberships order by user_id','select * from memberships_before order by user_id','Issuance never alters memberships');
select ok(not has_function_privilege(role,signature,'EXECUTE'),role||' cannot call '||signature)
from (values ('anon'),('authenticated')) roles(role)
cross join (values
 ('public.reserve_invitation_send(uuid,text,uuid)'),
 ('public.bind_invitation_send_subject(uuid,bigint,uuid,uuid)'),
 ('public.record_invitation_send_outcome(uuid,bigint,text,uuid,text)')) functions(signature);
select ok(has_function_privilege('service_role',signature,'EXECUTE'),'Service role can call '||signature)
from (values ('public.reserve_invitation_send(uuid,text,uuid)'),('public.bind_invitation_send_subject(uuid,bigint,uuid,uuid)'),('public.record_invitation_send_outcome(uuid,bigint,text,uuid,text)')) functions(signature);
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
 lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
 where n.nspname='public' and p.proname in ('reserve_invitation_send','bind_invitation_send_subject','record_invitation_send_outcome') and acl.grantee=0 and acl.privilege_type='EXECUTE'),'PUBLIC has no function execution');
select * from finish();
rollback;
