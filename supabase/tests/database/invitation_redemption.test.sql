-- Catches premature admission, correlation-only authority, and partial writes.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
select has_function('public','redeem_invitation',array['uuid','bigint','uuid','text','uuid','text','uuid','text'],'restricted redemption interface exists');
select ok(not has_function_privilege('anon','public.redeem_invitation(uuid,bigint,uuid,text,uuid,text,uuid,text)','execute'),'anonymous users cannot redeem directly');
select ok(not has_function_privilege('authenticated','public.redeem_invitation(uuid,bigint,uuid,text,uuid,text,uuid,text)','execute'),'members/admins cannot redeem directly');
select ok(has_function_privilege('service_role','public.redeem_invitation(uuid,bigint,uuid,text,uuid,text,uuid,text)','execute'),'trusted server can redeem');

insert into auth.users(id,email,email_confirmed_at) values
 ('11000000-0000-4000-8000-000000000152','redeem-admin@example.invalid',now()),
 ('22000000-0000-4000-8000-000000000152','Redeem+tag@example.invalid',now());
insert into auth.sessions(id,user_id) values
 ('55000000-0000-4000-8000-000000000152','22000000-0000-4000-8000-000000000152'),
 ('55000000-0000-4000-8000-000000000153','22000000-0000-4000-8000-000000000152');
insert into public.invitations(id,recipient_email,invited_by_user_id,auth_user_id,status,created_at) values
 ('33000000-0000-4000-8000-000000000152','redeem+tag@example.invalid','11000000-0000-4000-8000-000000000152','22000000-0000-4000-8000-000000000152','issued','2000-01-01'),
 ('33000000-0000-4000-8000-000000000153','replacement@example.invalid','11000000-0000-4000-8000-000000000152',null,'pending_issuance',now());
insert into public.invitation_send_attempts(invitation_id,invitation_version,requested_by_user_id,kind,outcome,completed_at) values
 ('33000000-0000-4000-8000-000000000152',1,'11000000-0000-4000-8000-000000000152','initial','accepted',now());
select is(public.record_verified_invitation_setup('22000000-0000-4000-8000-000000000152','REDEEM+tag@example.invalid','55000000-0000-4000-8000-000000000152','https://redeem.example.invalid',repeat('d',64),'33000000-0000-4000-8000-000000000152',1,null,null,'invite')->>'code','recorded','fixture uses real setup persistence');

create function pg_temp.snapshot() returns jsonb language sql as $$
 select jsonb_build_object('invitation',(select to_jsonb(i) from public.invitations i where id='33000000-0000-4000-8000-000000000152'),
 'membership',(select to_jsonb(m) from public.memberships m where user_id='22000000-0000-4000-8000-000000000152'),
 'authority',(select to_jsonb(s) from public.invitation_setup_authorizations s where invitation_id='33000000-0000-4000-8000-000000000152'));
$$;
create function pg_temp.authority() returns uuid language sql as $$
 select setup_authorization_id from public.invitations where id='33000000-0000-4000-8000-000000000152';
$$;
create function pg_temp.redeem_fixture(
 invitation uuid default '33000000-0000-4000-8000-000000000152', version bigint default 1,
 authority uuid default pg_temp.authority(),
 digest text default repeat('d',64), subject uuid default '22000000-0000-4000-8000-000000000152',
 email text default 'REDEEM+tag@example.invalid', session uuid default '55000000-0000-4000-8000-000000000152',
 origin text default 'https://redeem.example.invalid') returns jsonb language plpgsql as $$
begin
 return public.redeem_invitation(invitation,version,authority,digest,subject,email,session,origin);
end;
$$;
-- Save complete records around every rejected call, not only membership counts.
create function pg_temp.expect_rejection(label text, expected text default 'denied',
 invitation uuid default '33000000-0000-4000-8000-000000000152', version bigint default 1,
 authority uuid default pg_temp.authority(),
 digest text default repeat('d',64), subject uuid default '22000000-0000-4000-8000-000000000152',
 email text default 'REDEEM+tag@example.invalid', session uuid default '55000000-0000-4000-8000-000000000152',
 origin text default 'https://redeem.example.invalid') returns setof text language plpgsql as $$
declare before_state jsonb:=pg_temp.snapshot(); result jsonb;
begin
 result:=pg_temp.redeem_fixture(invitation,version,authority,digest,subject,email,session,origin);
 return next extensions.is(result->>'code',expected,label);
 return next extensions.is(pg_temp.snapshot(),before_state,label||' preserves both records and setup');
end;
$$;
select * from pg_temp.expect_rejection('password evidence missing');
update public.invitations set status='password_established',password_established_at=clock_timestamp(),updated_at=clock_timestamp() where id='33000000-0000-4000-8000-000000000152';
select * from pg_temp.expect_rejection('null invitation',invitation=>null);
select * from pg_temp.expect_rejection('null version',version=>null);
select * from pg_temp.expect_rejection('null authority',authority=>null);
select * from pg_temp.expect_rejection('null digest',digest=>null);
select * from pg_temp.expect_rejection('null subject',subject=>null);
select * from pg_temp.expect_rejection('null email',email=>null);
select * from pg_temp.expect_rejection('null session',session=>null);
select * from pg_temp.expect_rejection('null origin',origin=>null);
select * from pg_temp.expect_rejection('invalid version',version=>0);
select * from pg_temp.expect_rejection('malformed digest',digest=>'invalid');
select * from pg_temp.expect_rejection('wrong digest',digest=>repeat('e',64));
select * from pg_temp.expect_rejection('wrong authority',authority=>'66000000-0000-4000-8000-000000000152');
select * from pg_temp.expect_rejection('wrong subject',subject=>'11000000-0000-4000-8000-000000000152');
select * from pg_temp.expect_rejection('wrong email',email=>'other@example.invalid');
select * from pg_temp.expect_rejection('wrong origin',origin=>'https://foreign.example.invalid');
select * from pg_temp.expect_rejection('another valid session',session=>'55000000-0000-4000-8000-000000000153');
select * from pg_temp.expect_rejection('missing invitation','conflict',invitation=>'33000000-0000-4000-8000-000000000154');
select * from pg_temp.expect_rejection('stale version','conflict',version=>2);
update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id='55000000-0000-4000-8000-000000000152';
select * from pg_temp.expect_rejection('expired Auth session');
update auth.sessions set not_after=null where id='55000000-0000-4000-8000-000000000152';
update auth.users set banned_until=clock_timestamp()+interval '1 day' where id='22000000-0000-4000-8000-000000000152';
select * from pg_temp.expect_rejection('banned recipient');
update auth.users set banned_until=null,is_anonymous=true where id='22000000-0000-4000-8000-000000000152';
select * from pg_temp.expect_rejection('anonymous recipient');
update auth.users set is_anonymous=false,email_confirmed_at=null where id='22000000-0000-4000-8000-000000000152';
select * from pg_temp.expect_rejection('unconfirmed recipient');
update auth.users set email_confirmed_at=now(),email='changed@example.invalid' where id='22000000-0000-4000-8000-000000000152';
select * from pg_temp.expect_rejection('provider email changed');
update auth.users set email='Redeem+tag@example.invalid' where id='22000000-0000-4000-8000-000000000152';
savepoint expired_setup;
update public.invitation_setup_authorizations set created_at=now()-interval '31 minutes',expires_at=now()-interval '1 minute' where invitation_id='33000000-0000-4000-8000-000000000152';
select * from pg_temp.expect_rejection('expired setup');
rollback to expired_setup;
savepoint revoked;
update public.invitations set status='revoked',revoked_at=clock_timestamp(),revoked_by_user_id='11000000-0000-4000-8000-000000000152',revocation_reason='Owned fixture' where id='33000000-0000-4000-8000-000000000152';
select * from pg_temp.expect_rejection('revoked invitation','conflict');
rollback to revoked;
savepoint superseded;
update public.invitations set status='superseded',superseded_at=clock_timestamp(),superseded_by_id='33000000-0000-4000-8000-000000000153' where id='33000000-0000-4000-8000-000000000152';
select * from pg_temp.expect_rejection('superseded invitation','conflict');
rollback to superseded;
insert into public.memberships(user_id,role) values ('22000000-0000-4000-8000-000000000152','admin');
select * from pg_temp.expect_rejection('existing active admin membership');
update public.memberships set status='disabled',disabled_at=clock_timestamp(),disabled_reason='Owned fixture' where user_id='22000000-0000-4000-8000-000000000152';
select * from pg_temp.expect_rejection('existing disabled membership');
delete from public.memberships where user_id='22000000-0000-4000-8000-000000000152';

create function pg_temp.fail_redemption() returns trigger language plpgsql as $$
begin
 if new.id='33000000-0000-4000-8000-000000000152' and new.status='redeemed' then raise exception 'Owned forced failure' using errcode='P0001'; end if;
 return new;
end;
$$;
create trigger owned_fail_redemption before update on public.invitations for each row execute function pg_temp.fail_redemption();
create temporary table before_failure as select pg_temp.snapshot() as value;
select throws_ok('select pg_temp.redeem_fixture()','P0001','Owned forced failure','late failure propagates');
select is(pg_temp.snapshot(),(select value from before_failure),'late failure rolls membership and invitation back');
drop trigger owned_fail_redemption on public.invitations;
set local role service_role;
-- pg_temp helper is deliberately owned by postgres; the production RPC is invoked as service role.
select is(public.redeem_invitation('33000000-0000-4000-8000-000000000152',1,(select setup_authorization_id from public.invitations where id='33000000-0000-4000-8000-000000000152'),repeat('d',64),'22000000-0000-4000-8000-000000000152','REDEEM+tag@example.invalid','55000000-0000-4000-8000-000000000152','https://redeem.example.invalid')->>'code','redeemed','old eligible invitation commits through service role');
reset role;
select ok((select role='member' and status='active' from public.memberships where user_id='22000000-0000-4000-8000-000000000152'),'only active member membership created');
select ok((select status='redeemed' and redeemed_at>=password_established_at from public.invitations where id='33000000-0000-4000-8000-000000000152'),'redemption evidence committed with membership');
create temporary table completed_state as select pg_temp.snapshot() as value;
select is(pg_temp.redeem_fixture()->>'code','already_redeemed','identical retry reports completion');
select is(pg_temp.snapshot(),(select value from completed_state),'completed retry performs no writes');
select is(public.read_verified_invitation_setup(repeat('d',64),'22000000-0000-4000-8000-000000000152','REDEEM+tag@example.invalid','55000000-0000-4000-8000-000000000152','https://redeem.example.invalid')->>'code','denied','retained completion context cannot authorize password setup');
select * from pg_temp.expect_rejection('wrong digest on completed retry',digest=>repeat('e',64));
select * from pg_temp.expect_rejection('wrong session on completed retry',session=>'55000000-0000-4000-8000-000000000153');
update public.memberships set status='disabled',disabled_at=clock_timestamp(),disabled_reason='Owned fixture' where user_id='22000000-0000-4000-8000-000000000152';
update completed_state set value=pg_temp.snapshot();
select is(pg_temp.redeem_fixture()->>'code','already_redeemed','completed retry reports historical completion after disabling');
select is(pg_temp.snapshot(),(select value from completed_state),'retry never re-enables disabled membership');
update public.invitation_setup_authorizations set created_at=now()-interval '31 minutes',expires_at=now()-interval '1 minute' where invitation_id='33000000-0000-4000-8000-000000000152';
select * from pg_temp.expect_rejection('expired completed context');
create temporary table terminal_evidence as select to_jsonb(i) as value from public.invitations i where id='33000000-0000-4000-8000-000000000152';
select public.cleanup_invitation_confirmation();
select is((select count(*) from public.invitation_setup_authorizations where invitation_id='33000000-0000-4000-8000-000000000152'),0::bigint,'existing cron cleanup removes completed context');
select is((select to_jsonb(i) from public.invitations i where id='33000000-0000-4000-8000-000000000152'),(select value from terminal_evidence),'cleanup preserves terminal redemption snapshot');
select * from pg_temp.expect_rejection('cleaned completed context');
select * from finish();
rollback;
