begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
-- These tests catch missing constraints/access denial, using real PostgreSQL writes.
select has_table('public', 'invitations', 'Invitation persistence exists');
select has_table('public', 'invitation_send_attempts', 'Durable send reservations exist');
insert into auth.users (id, email) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','inviter@example.invalid'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','recipient@example.invalid'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','disabled@example.invalid'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','unadmitted@example.invalid');
insert into public.memberships (user_id, role, status, disabled_at, disabled_reason) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','admin','active',null,null),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','member','disabled',now(),'Test fixture');
create temporary table original_memberships as select * from public.memberships;
-- Test-only invoker helpers keep invalid snapshots readable. No business RPC is added.
create function pg_temp.invite(patch jsonb) returns void language plpgsql as $body$
declare r public.invitations;
begin
 r := jsonb_populate_record(null::public.invitations,
  jsonb_build_object('id',gen_random_uuid(),'recipient_email','candidate@example.invalid',
   'invited_by_user_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','status','pending_issuance',
   'version',1,'created_at','2000-01-01T00:00:00Z','updated_at','2000-01-01T00:00:00Z') || patch);
 insert into public.invitations(id,recipient_email,invited_by_user_id,status,version,
  auth_user_id,verified_user_id,verified_at,setup_authorization_id,password_established_at,
  created_at,updated_at,redeemed_at,revoked_at,revoked_by_user_id,revocation_reason,superseded_at,superseded_by_id)
 values(r.id,r.recipient_email,r.invited_by_user_id,r.status,r.version,r.auth_user_id,
  r.verified_user_id,r.verified_at,r.setup_authorization_id,r.password_established_at,
  r.created_at,r.updated_at,r.redeemed_at,r.revoked_at,r.revoked_by_user_id,r.revocation_reason,
  r.superseded_at,r.superseded_by_id);
end $body$;
create function pg_temp.attempt(patch jsonb) returns void language plpgsql as $body$
declare r public.invitation_send_attempts;
begin
 r := jsonb_populate_record(null::public.invitation_send_attempts,
  jsonb_build_object('id',gen_random_uuid(),'invitation_id','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   'invitation_version',1,'requested_by_user_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'kind','initial','outcome','started','started_at','2000-01-01T00:00:00Z') || patch);
 insert into public.invitation_send_attempts values(r.*);
end $body$;
select pg_temp.invite('{"id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","recipient_email":"Alice+tag@Example.invalid"}');
select is((select recipient_email_key from public.invitations where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
 'alice+tag@example.invalid','ASCII case folding preserves plus suffix');
select lives_ok('select pg_temp.invite(''{"recipient_email": "alice.tag@example.invalid"}''::jsonb)','Dots remain distinct');
select lives_ok('select pg_temp.invite(''{"recipient_email": "alice+other@example.invalid"}''::jsonb)','Plus suffixes remain distinct');
select throws_ok('select pg_temp.invite(''{"recipient_email": "ALICE+TAG@example.INVALID"}''::jsonb)','23505',null,'Case equivalent live email conflicts');
select throws_ok('select pg_temp.invite(''{"recipient_email": ""}''::jsonb)','23514',null,'Empty email rejected');
select throws_ok('select pg_temp.invite(''{"recipient_email": "   "}''::jsonb)','23514',null,'Blank email rejected');
select throws_ok('select pg_temp.invite(''{"recipient_email": " leading@example.invalid"}''::jsonb)','23514',null,'Leading whitespace rejected');
select throws_ok('select pg_temp.invite(''{"recipient_email": "trailing@example.invalid "}''::jsonb)','23514',null,'Trailing whitespace rejected');
select throws_ok('select pg_temp.invite(''{"recipient_email": "caf\u00e9@example.invalid"}''::jsonb)','23514',null,'Non ASCII rejected');
select throws_ok('select pg_temp.invite(''{"recipient_email": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}''::jsonb)','23514',null,'Overlong email rejected');
select lives_ok('select pg_temp.invite(''{"recipient_email": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}''::jsonb)','254 ASCII bytes permitted by structural limit');
select throws_ok('update public.invitations set recipient_email_key=''other@example.invalid'' where id=''eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee''','428C9',null,'Generated key cannot be overridden');
select throws_ok('select pg_temp.invite(''{"version": 0}''::jsonb)','23514',null,'Nonpositive version rejected 0');
select throws_ok('select pg_temp.invite(''{"version": -1}''::jsonb)','23514',null,'Nonpositive version rejected -1');
select throws_ok('select pg_temp.invite(''{"updated_at": "1999-01-01T00:00:00Z"}''::jsonb)','23514',null,'Updated time cannot precede creation');
select throws_ok('select pg_temp.invite(''{"invited_by_user_id": "88888888-8888-4888-8888-888888888888"}''::jsonb)','23503',null,'Missing invited_by_user_id FK rejected');
select throws_ok('select pg_temp.invite(''{"auth_user_id": "88888888-8888-4888-8888-888888888888", "status": "issued"}''::jsonb)','23503',null,'Missing auth_user_id FK rejected');
select throws_ok('select pg_temp.invite(''{"auth_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_user_id": "88888888-8888-4888-8888-888888888888", "verified_at": "2000-01-02T00:00:00Z", "setup_authorization_id": "99999999-9999-4999-8999-999999999999", "status": "setup_verified"}''::jsonb)','23503',null,'Missing verified_user_id FK rejected');
select throws_ok('select pg_temp.invite(''{"revoked_by_user_id": "88888888-8888-4888-8888-888888888888", "status": "revoked", "revoked_at": "2000-01-03T00:00:00Z", "revocation_reason": "Test"}''::jsonb)','23503',null,'Missing revoked_by_user_id FK rejected');
select throws_ok('select pg_temp.invite(''{"status": "issued"}''::jsonb)','23514',null,'issued requires Auth binding');
select throws_ok('select pg_temp.invite(''{"status": "setup_verified"}''::jsonb)','23514',null,'setup_verified requires Auth binding');
select throws_ok('select pg_temp.invite(''{"status": "password_established"}''::jsonb)','23514',null,'password_established requires Auth binding');
select throws_ok('select pg_temp.invite(''{"status": "redeemed"}''::jsonb)','23514',null,'redeemed requires Auth binding');
select lives_ok('select pg_temp.invite(''{"recipient_email": "issued@example.invalid", "status": "issued", "auth_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}''::jsonb)','Issued snapshot valid');
select throws_ok('select pg_temp.invite(''{"recipient_email": "second-subject@example.invalid", "status": "issued", "auth_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}''::jsonb)','23505',null,'One live invitation per subject');
select lives_ok('select pg_temp.invite(''{"auth_user_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "verified_user_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "verified_at": "2000-01-02T00:00:00Z", "setup_authorization_id": "99999999-9999-4999-8999-999999999999", "recipient_email": "setup_verified@example.invalid", "status": "setup_verified"}''::jsonb)','setup_verified snapshot valid');
select lives_ok('select pg_temp.invite(''{"auth_user_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "verified_user_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "verified_at": "2000-01-02T00:00:00Z", "setup_authorization_id": "99999999-9999-4999-8999-999999999999", "recipient_email": "password_established@example.invalid", "status": "password_established", "password_established_at": "2000-01-03T00:00:00Z"}''::jsonb)','password_established snapshot valid');
select lives_ok('select pg_temp.invite(''{"auth_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_at": "2000-01-02T00:00:00Z", "setup_authorization_id": "99999999-9999-4999-8999-999999999999", "recipient_email": "redeemed@example.invalid", "status": "redeemed", "password_established_at": "2000-01-03T00:00:00Z", "redeemed_at": "2000-01-04T00:00:00Z"}''::jsonb)','Redeemed history releases subject uniqueness');
select throws_ok('select pg_temp.invite(''{"auth_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_user_id": null, "verified_at": "2000-01-02T00:00:00Z", "setup_authorization_id": "99999999-9999-4999-8999-999999999999", "status": "setup_verified"}''::jsonb)','23514',null,'Incomplete setup triple rejected: verified_user_id');
select throws_ok('select pg_temp.invite(''{"auth_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_at": null, "setup_authorization_id": "99999999-9999-4999-8999-999999999999", "status": "setup_verified"}''::jsonb)','23514',null,'Incomplete setup triple rejected: verified_at');
select throws_ok('select pg_temp.invite(''{"auth_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_at": "2000-01-02T00:00:00Z", "setup_authorization_id": null, "status": "setup_verified"}''::jsonb)','23514',null,'Incomplete setup triple rejected: setup_authorization_id');
select throws_ok('select pg_temp.invite(''{"auth_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_user_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "verified_at": "2000-01-02T00:00:00Z", "setup_authorization_id": "99999999-9999-4999-8999-999999999999", "status": "setup_verified"}''::jsonb)','23514',null,'Verified subject must match bound subject');
select throws_ok('select pg_temp.invite(''{"verified_at": "2000-01-02T00:00:00Z"}''::jsonb)','23514',null,'Pending snapshot cannot claim setup evidence');
select throws_ok('select pg_temp.invite(''{"auth_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_at": "2000-01-02T00:00:00Z", "setup_authorization_id": "99999999-9999-4999-8999-999999999999", "status": "issued"}''::jsonb)','23514',null,'Issued snapshot cannot claim setup evidence');
select throws_ok('select pg_temp.invite(''{"auth_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_at": "2000-01-02T00:00:00Z", "setup_authorization_id": "99999999-9999-4999-8999-999999999999", "status": "setup_verified", "password_established_at": "2000-01-03T00:00:00Z"}''::jsonb)','23514',null,'Verified state cannot claim password success');
select throws_ok('select pg_temp.invite(''{"auth_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_at": "2000-01-02T00:00:00Z", "setup_authorization_id": "99999999-9999-4999-8999-999999999999", "status": "password_established"}''::jsonb)','23514',null,'Password state requires timestamp');
select throws_ok('select pg_temp.invite(''{"auth_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_at": "2000-01-02T00:00:00Z", "setup_authorization_id": "99999999-9999-4999-8999-999999999999", "status": "password_established", "password_established_at": "2000-01-01T00:00:00Z"}''::jsonb)','23514',null,'Password cannot precede verification');
select throws_ok('select pg_temp.invite(''{"auth_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_at": "1999-01-01T00:00:00Z", "setup_authorization_id": "99999999-9999-4999-8999-999999999999", "status": "setup_verified"}''::jsonb)','23514',null,'Verification cannot precede creation');
select throws_ok('select pg_temp.invite(''{"auth_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_at": "2000-01-02T00:00:00Z", "setup_authorization_id": "99999999-9999-4999-8999-999999999999", "status": "redeemed", "password_established_at": "2000-01-03T00:00:00Z"}''::jsonb)','23514',null,'Redemption requires timestamp');
select throws_ok('select pg_temp.invite(''{"auth_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_at": "2000-01-02T00:00:00Z", "setup_authorization_id": "99999999-9999-4999-8999-999999999999", "status": "redeemed", "password_established_at": "2000-01-03T00:00:00Z", "redeemed_at": "2000-01-02T00:00:00Z"}''::jsonb)','23514',null,'Redemption cannot precede password');
select throws_ok('select pg_temp.invite(''{"redeemed_at": "2000-01-03T00:00:00Z"}''::jsonb)','23514',null,'Nonterminal snapshot rejects redeemed_at');
select throws_ok('select pg_temp.invite(''{"revoked_at": "2000-01-03T00:00:00Z"}''::jsonb)','23514',null,'Nonterminal snapshot rejects revoked_at');
select throws_ok('select pg_temp.invite(''{"revoked_by_user_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}''::jsonb)','23514',null,'Nonterminal snapshot rejects revoked_by_user_id');
select throws_ok('select pg_temp.invite(''{"revocation_reason": "Test"}''::jsonb)','23514',null,'Nonterminal snapshot rejects revocation_reason');
select throws_ok('select pg_temp.invite(''{"superseded_at": "2000-01-03T00:00:00Z"}''::jsonb)','23514',null,'Nonterminal snapshot rejects superseded_at');
select throws_ok('select pg_temp.invite(''{"superseded_by_id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}''::jsonb)','23514',null,'Nonterminal snapshot rejects superseded_by_id');
select lives_ok('select pg_temp.invite(''{"status": "revoked", "revoked_at": "2000-01-03T00:00:00Z", "revoked_by_user_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "revocation_reason": "Test", "recipient_email": "revoked@example.invalid"}''::jsonb)','Revocation before issuance valid');
select lives_ok('select pg_temp.invite(''{"status": "revoked", "revoked_at": "2000-01-03T00:00:00Z", "revoked_by_user_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "revocation_reason": "Test", "auth_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_user_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "verified_at": "2000-01-02T00:00:00Z", "setup_authorization_id": "99999999-9999-4999-8999-999999999999", "recipient_email": "revoked-setup@example.invalid", "password_established_at": "2000-01-03T00:00:00Z"}''::jsonb)','Revocation can retain complete audit evidence');
select throws_ok('select pg_temp.invite(''{"status": "revoked", "revoked_at": null, "revoked_by_user_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "revocation_reason": "Test"}''::jsonb)','23514',null,'Revocation requires revoked_at');
select throws_ok('select pg_temp.invite(''{"status": "revoked", "revoked_at": "2000-01-03T00:00:00Z", "revoked_by_user_id": null, "revocation_reason": "Test"}''::jsonb)','23514',null,'Revocation requires revoked_by_user_id');
select throws_ok('select pg_temp.invite(''{"status": "revoked", "revoked_at": "2000-01-03T00:00:00Z", "revoked_by_user_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "revocation_reason": null}''::jsonb)','23514',null,'Revocation requires revocation_reason');
select throws_ok('select pg_temp.invite(''{"status": "revoked", "revoked_at": "2000-01-03T00:00:00Z", "revoked_by_user_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "revocation_reason": ""}''::jsonb)','23514',null,'Invalid revocation reason rejected 0');
select throws_ok('select pg_temp.invite(''{"status": "revoked", "revoked_at": "2000-01-03T00:00:00Z", "revoked_by_user_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "revocation_reason": "  "}''::jsonb)','23514',null,'Invalid revocation reason rejected 2');
select throws_ok('select pg_temp.invite(''{"status": "revoked", "revoked_at": "2000-01-03T00:00:00Z", "revoked_by_user_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "revocation_reason": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}''::jsonb)','23514',null,'Invalid revocation reason rejected 501');
select throws_ok('select pg_temp.invite(''{"status": "revoked", "revoked_at": "1999-01-01T00:00:00Z", "revoked_by_user_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "revocation_reason": "Test"}''::jsonb)','23514',null,'Revocation cannot precede creation');
select throws_ok('select pg_temp.invite(''{"status": "revoked", "revoked_at": "2000-01-03T00:00:00Z", "revoked_by_user_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "revocation_reason": "Test", "password_established_at": "2000-01-03T00:00:00Z"}''::jsonb)','23514',null,'Terminal password without verified evidence rejected');
select lives_ok('select pg_temp.invite(''{"status": "superseded", "superseded_at": "2000-01-03T00:00:00Z", "superseded_by_id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "recipient_email": "superseded@example.invalid"}''::jsonb)','Supersession snapshot valid');
select throws_ok('select pg_temp.invite(''{"status": "superseded", "superseded_at": null, "superseded_by_id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}''::jsonb)','23514',null,'Supersession requires superseded_at');
select throws_ok('select pg_temp.invite(''{"status": "superseded", "superseded_at": "2000-01-03T00:00:00Z", "superseded_by_id": null}''::jsonb)','23514',null,'Supersession requires superseded_by_id');
select throws_ok('select pg_temp.invite(''{"status": "superseded", "superseded_at": "2000-01-03T00:00:00Z", "superseded_by_id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}''::jsonb)','23514',null,'Self supersession rejected');
select throws_ok('select pg_temp.invite(''{"status": "superseded", "superseded_at": "2000-01-03T00:00:00Z", "superseded_by_id": "88888888-8888-4888-8888-888888888888"}''::jsonb)','23503',null,'Missing replacement rejected');
select throws_ok('select pg_temp.invite(''{"status": "superseded", "superseded_at": "1999-01-01T00:00:00Z", "superseded_by_id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}''::jsonb)','23514',null,'Supersession cannot precede creation');
select lives_ok('select pg_temp.invite(''{"recipient_email": "revoked@example.invalid"}''::jsonb)','Terminal email can have a new live record structurally');
select lives_ok('select pg_temp.attempt(''{}''::jsonb)','Durable started reservation valid');
select throws_ok('select pg_temp.attempt(''{}''::jsonb)','23505',null,'Only one attempt per generation');
select lives_ok('select pg_temp.attempt(''{"invitation_version": 2, "outcome": "accepted", "completed_at": "2000-01-02T00:00:00Z"}''::jsonb)','accepted outcome valid');
select throws_ok('select pg_temp.attempt(''{"invitation_version": 10, "outcome": "accepted"}''::jsonb)','23514',null,'accepted requires completion time');
select lives_ok('select pg_temp.attempt(''{"invitation_version": 3, "outcome": "rejected", "completed_at": "2000-01-02T00:00:00Z"}''::jsonb)','rejected outcome valid');
select throws_ok('select pg_temp.attempt(''{"invitation_version": 10, "outcome": "rejected"}''::jsonb)','23514',null,'rejected requires completion time');
select lives_ok('select pg_temp.attempt(''{"invitation_version": 4, "outcome": "unknown", "completed_at": "2000-01-02T00:00:00Z"}''::jsonb)','unknown outcome valid');
select throws_ok('select pg_temp.attempt(''{"invitation_version": 10, "outcome": "unknown"}''::jsonb)','23514',null,'unknown requires completion time');
select lives_ok('select pg_temp.attempt(''{"invitation_version": 5, "reconciled_outcome": "accepted", "reconciled_at": "2000-01-03T00:00:00Z"}''::jsonb)','Started operation may be reconciled without rewriting first outcome');
select lives_ok('select pg_temp.attempt(''{"invitation_version": 6, "outcome": "unknown", "completed_at": "2000-01-02T00:00:00Z", "reconciled_outcome": "rejected", "reconciled_at": "2000-01-03T00:00:00Z", "provider_error_code": "timeout"}''::jsonb)','Unknown operation may be reconciled');
select throws_ok('select pg_temp.attempt(''{"invitation_version": 10, "completed_at": "2000-01-02T00:00:00Z"}''::jsonb)','23514',null,'Started has no completion');
select throws_ok('select pg_temp.attempt(''{"invitation_version": 10, "outcome": "accepted", "completed_at": "1999-01-01T00:00:00Z"}''::jsonb)','23514',null,'Completion cannot precede start');
select throws_ok('select pg_temp.attempt(''{"invitation_version": 10, "reconciled_outcome": "accepted"}''::jsonb)','23514',null,'Resolution requires time');
select throws_ok('select pg_temp.attempt(''{"invitation_version": 10, "reconciled_at": "2000-01-03T00:00:00Z"}''::jsonb)','23514',null,'Resolution time requires outcome');
select throws_ok('select pg_temp.attempt(''{"invitation_version": 10, "outcome": "accepted", "completed_at": "2000-01-02T00:00:00Z", "reconciled_outcome": "rejected", "reconciled_at": "2000-01-03T00:00:00Z"}''::jsonb)','23514',null,'Known first outcome cannot be reconciled');
select throws_ok('select pg_temp.attempt(''{"invitation_version": 10, "outcome": "unknown", "completed_at": "2000-01-03T00:00:00Z", "reconciled_outcome": "accepted", "reconciled_at": "2000-01-02T00:00:00Z"}''::jsonb)','23514',null,'Resolution cannot precede first observation');
select throws_ok('select pg_temp.attempt(''{"invitation_version": 10, "reconciled_outcome": "accepted", "reconciled_at": "1999-01-01T00:00:00Z"}''::jsonb)','23514',null,'Resolution cannot precede start');
select throws_ok('select pg_temp.attempt(''{"invitation_version": 10, "provider_error_code": "SDK error password=secret"}''::jsonb)','23514',null,'Raw provider error rejected');
select throws_ok('select pg_temp.attempt(''{"invitation_version": 0}''::jsonb)','23514',null,'Attempt version positive');
select throws_ok('select pg_temp.attempt(''{"invitation_version": 10, "invitation_id": "88888888-8888-4888-8888-888888888888"}''::jsonb)','23503',null,'Attempt parent required');
select throws_ok('select pg_temp.attempt(''{"invitation_version": 10, "requested_by_user_id": "88888888-8888-4888-8888-888888888888"}''::jsonb)','23503',null,'Attempt requester required');
update public.invitations set version=20 where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
select is((select count(*)::integer from public.invitation_send_attempts where invitation_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),6,'Historical generations survive parent version advance');
select throws_ok('delete from auth.users where id=''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa''','23503',null,'Inviter/requester deletion restricted');
select throws_ok('delete from auth.users where id=''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb''','23503',null,'Recipient deletion restricted');
select throws_ok('delete from public.invitations where id=''eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee''','23503',null,'Parent/history deletion restricted');
select results_eq('select * from public.memberships order by user_id',
 'select * from original_memberships order by user_id','Invitation snapshots never admit or alter memberships');
select ok((select relrowsecurity from pg_class where oid='public.invitations'::regclass),'invitations RLS enabled');
select ok(not has_table_privilege('anon','public.invitations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'anon has no invitations privileges');
select ok(not has_table_privilege('authenticated','public.invitations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'authenticated has no invitations privileges');
select ok((select relrowsecurity from pg_class where oid='public.invitation_send_attempts'::regclass),'invitation_send_attempts RLS enabled');
select ok(not has_table_privilege('anon','public.invitation_send_attempts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'anon has no invitation_send_attempts privileges');
select ok(not has_table_privilege('authenticated','public.invitation_send_attempts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'authenticated has no invitation_send_attempts privileges');
set local role anon;
select throws_ok('select * from public.invitations','42501',null,'anon invitations read denied');
select throws_ok('insert into public.invitations default values','42501',null,'anon invitations insert denied');
select throws_ok('update public.invitations set id=id','42501',null,'anon invitations update denied');
select throws_ok('delete from public.invitations','42501',null,'anon invitations delete denied');
select throws_ok('select * from public.invitation_send_attempts','42501',null,'anon invitation_send_attempts read denied');
select throws_ok('insert into public.invitation_send_attempts default values','42501',null,'anon invitation_send_attempts insert denied');
select throws_ok('update public.invitation_send_attempts set id=id','42501',null,'anon invitation_send_attempts update denied');
select throws_ok('delete from public.invitation_send_attempts','42501',null,'anon invitation_send_attempts delete denied');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}',true);
select throws_ok('select * from public.invitations','42501',null,'authenticated admin invitations read denied');
select throws_ok('insert into public.invitations default values','42501',null,'authenticated admin invitations insert denied');
select throws_ok('update public.invitations set id=id','42501',null,'authenticated admin invitations update denied');
select throws_ok('delete from public.invitations','42501',null,'authenticated admin invitations delete denied');
select throws_ok('select * from public.invitation_send_attempts','42501',null,'authenticated admin invitation_send_attempts read denied');
select throws_ok('insert into public.invitation_send_attempts default values','42501',null,'authenticated admin invitation_send_attempts insert denied');
select throws_ok('update public.invitation_send_attempts set id=id','42501',null,'authenticated admin invitation_send_attempts update denied');
select throws_ok('delete from public.invitation_send_attempts','42501',null,'authenticated admin invitation_send_attempts delete denied');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "role": "authenticated"}',true);
select throws_ok('select * from public.invitations','42501',null,'authenticated disabled invitations read denied');
select throws_ok('insert into public.invitations default values','42501',null,'authenticated disabled invitations insert denied');
select throws_ok('update public.invitations set id=id','42501',null,'authenticated disabled invitations update denied');
select throws_ok('delete from public.invitations','42501',null,'authenticated disabled invitations delete denied');
select throws_ok('select * from public.invitation_send_attempts','42501',null,'authenticated disabled invitation_send_attempts read denied');
select throws_ok('insert into public.invitation_send_attempts default values','42501',null,'authenticated disabled invitation_send_attempts insert denied');
select throws_ok('update public.invitation_send_attempts set id=id','42501',null,'authenticated disabled invitation_send_attempts update denied');
select throws_ok('delete from public.invitation_send_attempts','42501',null,'authenticated disabled invitation_send_attempts delete denied');
reset role;
set local role service_role;
select lives_ok('select pg_temp.invite(''{"recipient_email": "service@example.invalid"}''::jsonb)','Service can insert invitation');
select lives_ok('select pg_temp.attempt(''{"invitation_version": 21, "kind": "resend"}''::jsonb)','Service can insert resend attempt');
select lives_ok('update public.invitations set updated_at=now() where recipient_email=''service@example.invalid''','Service can update invitation');
select lives_ok('select * from public.invitation_send_attempts','Service can read attempts');
reset role;
select * from finish();
rollback;
