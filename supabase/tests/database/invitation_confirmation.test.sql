begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
select has_table('public','invitation_confirmation_transports','encrypted transport persistence exists');
select has_table('public','invitation_setup_authorizations','separate setup authority exists');
select has_function('public','claim_invitation_confirmation_transport',array['text','text','text'],'transport is claimed through an atomic server function');
select has_function('public','record_verified_invitation_setup',array['uuid','text','uuid','text','text','uuid','bigint','uuid','text','text'],'setup and resend proof share a transaction');
select has_function('public','cleanup_invitation_confirmation',array[]::text[],'idle secret cleanup exists');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.invitation_confirmation_transports'::regclass,'public.invitation_setup_authorizations'::regclass)),'both secret stores have RLS');
select ok(not has_table_privilege('anon','public.invitation_confirmation_transports','select') and not has_table_privilege('authenticated','public.invitation_setup_authorizations','select'),'browser roles cannot read either secret store');
select ok(not has_function_privilege('authenticated','public.claim_invitation_confirmation_transport(text,text,text)','execute'),'application admins have no direct transport authority');
select ok(exists(select 1 from cron.job where jobname='volo-invitation-confirmation-cleanup' and schedule='*/5 * * * *' and active),'idle cleanup is installed');
create function pg_temp.create_transport(n integer,origin text default 'https://confirm.example.invalid') returns jsonb language sql as $$
 select public.create_invitation_confirmation_transport(lpad(n::text,64,'0'),repeat('b',64),origin,clock_timestamp()+interval '9 minutes','fixture',repeat('A',16),repeat('A',100),repeat('A',22));
$$;
select is(pg_temp.create_transport(1)->>'code','created','transport creation accepted');
select is(public.claim_invitation_confirmation_transport(lpad('1',64,'0'),repeat('c',64),'https://confirm.example.invalid')->>'code','denied','wrong CSRF cannot claim');
select is(public.read_invitation_confirmation_transport(lpad('1',64,'0'),'https://confirm.example.invalid')->>'code','found','bad CSRF leaves valid transport');
select is(public.claim_invitation_confirmation_transport(lpad('1',64,'0'),repeat('b',64),'https://confirm.example.invalid')->>'code','claimed','correct context claims once');
select is(public.claim_invitation_confirmation_transport(lpad('1',64,'0'),repeat('b',64),'https://confirm.example.invalid')->>'code','denied','replay denied');
select ok((select ciphertext is null and nonce is null and tag is null from public.invitation_confirmation_transports where lookup_digest=lpad('1',64,'0')),'claim physically erases encrypted material');
select pg_temp.create_transport(n) from generate_series(2,60) n;
select is(pg_temp.create_transport(61)->>'code','limited','claimed tombstones still limit anonymous creation');
delete from public.invitation_confirmation_transports;
insert into public.invitation_confirmation_transports(lookup_digest,csrf_digest,origin,created_at,expires_at,key_id,nonce,ciphertext,tag)
 select lpad(n::text,64,'0'),repeat('b',64),'https://cap.example.invalid',clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '5 minutes','fixture',repeat('A',16),repeat('A',100),repeat('A',22) from generate_series(1,1024) n;
select is(pg_temp.create_transport(1025)->>'code','limited','global cap denies storage growth');
delete from public.invitation_confirmation_transports;
select pg_temp.create_transport(1);
update public.invitation_confirmation_transports set created_at=clock_timestamp()-interval '11 minutes',expires_at=clock_timestamp()-interval '1 minute';
select public.cleanup_invitation_confirmation();
select is((select count(*) from public.invitation_confirmation_transports),0::bigint,'cleanup erases expired transport without a later HTTP request');

insert into auth.users(id,email,email_confirmed_at) values
 ('11000000-0000-4000-8000-000000000001','confirm-admin@example.invalid',now()),
 ('22000000-0000-4000-8000-000000000001','Confirm+tag@example.invalid',now());
insert into auth.sessions(id,user_id) values ('55000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001');
insert into public.invitations(id,recipient_email,invited_by_user_id,auth_user_id,status,created_at) values
 ('33000000-0000-4000-8000-000000000001','confirm+tag@example.invalid','11000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','issued','2000-01-01');
insert into public.invitation_send_attempts(id,invitation_id,invitation_version,requested_by_user_id,kind,outcome,completed_at) values
 ('44000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001',1,'11000000-0000-4000-8000-000000000001','initial','accepted',now());
create function pg_temp.setup(session uuid default '55000000-0000-4000-8000-000000000001',v bigint default 1,attempt uuid default null,resume text default null,transport text default 'invite') returns jsonb language sql as $$
 select public.record_verified_invitation_setup('22000000-0000-4000-8000-000000000001','CONFIRM+tag@example.invalid',session,'https://confirm.example.invalid',repeat('d',64),'33000000-0000-4000-8000-000000000001',v,attempt,resume,transport);
$$;
select is(pg_temp.setup('55000000-0000-4000-8000-000000000002')->>'code','denied','unverified nonexistent session cannot authorize setup');
select is(pg_temp.setup()->>'code','recorded','old otherwise eligible initial invite establishes setup');
select is((select count(*) from public.memberships where user_id='22000000-0000-4000-8000-000000000001'),0::bigint,'setup creates no membership');
select ok((select expires_at=created_at+interval '30 minutes' from public.invitation_setup_authorizations where invitation_id='33000000-0000-4000-8000-000000000001'),'setup expires separately after thirty minutes');
select is(public.read_verified_invitation_setup(repeat('d',64),'22000000-0000-4000-8000-000000000001','Confirm+tag@example.invalid','55000000-0000-4000-8000-000000000001','https://confirm.example.invalid')->>'code','authorized','matching verified session reads setup');
select is(public.read_verified_invitation_setup(repeat('d',64),'22000000-0000-4000-8000-000000000001','Confirm+tag@example.invalid','55000000-0000-4000-8000-000000000002','https://confirm.example.invalid')->>'code','denied','another login never inherits setup');
select is(pg_temp.setup()->>'code','stale','same provider evidence cannot recreate setup');
update public.invitation_setup_authorizations set created_at=now()-interval '31 minutes',expires_at=now()-interval '1 minute';
select public.cleanup_invitation_confirmation();
select is((select status::text from public.invitations where id='33000000-0000-4000-8000-000000000001'),'issued','expiry clears matching live snapshot without ending invitation eligibility');
select is((select count(*) from public.invitation_setup_authorizations),0::bigint,'expired setup authority physically removed');
update public.invitations set version=2 where id='33000000-0000-4000-8000-000000000001';
insert into public.invitation_send_attempts(id,invitation_id,invitation_version,requested_by_user_id,kind,outcome,completed_at) values
 ('44000000-0000-4000-8000-000000000002','33000000-0000-4000-8000-000000000001',2,'11000000-0000-4000-8000-000000000001','resend','accepted',now());
insert into public.invitation_send_proofs(attempt_id,secret_digest,transport) values ('44000000-0000-4000-8000-000000000002',repeat('e',64),'recovery');
select is(pg_temp.setup(v=>2)->>'code','denied','initial link cannot authorize the newer resend generation');
select is(pg_temp.setup(v=>2,attempt=>'44000000-0000-4000-8000-000000000002',resume=>repeat('e',64),transport=>'invite')->>'code','denied','wrong provider transport cannot consume resend proof');
select ok((select consumed_at is null from public.invitation_send_proofs where attempt_id='44000000-0000-4000-8000-000000000002'),'denied setup leaves proof untouched');
select is(pg_temp.setup(v=>2,attempt=>'44000000-0000-4000-8000-000000000002',resume=>repeat('e',64),transport=>'recovery')->>'code','recorded','verified resend consumes proof with setup');
select ok((select consumed_at is not null from public.invitation_send_proofs where attempt_id='44000000-0000-4000-8000-000000000002'),'proof consumed by successful setup transaction');
select * from finish();
rollback;
