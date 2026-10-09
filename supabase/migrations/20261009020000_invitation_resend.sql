-- VOLO-149: provider calls remain outside these short transactions.
begin;
create table public.invitation_send_proofs (
 attempt_id uuid primary key references public.invitation_send_attempts(id) on delete restrict,
 secret_digest text not null check (secret_digest collate "C" ~ '^[0-9a-f]{64}$'),
 transport text not null check (transport in ('invite','recovery')),
 consumed_at timestamptz
);
alter table public.invitation_send_proofs enable row level security;
revoke all on public.invitation_send_proofs from public,anon,authenticated,service_role;
grant select on public.invitation_send_proofs to service_role;
comment on table public.invitation_send_proofs is
 'Single-use resend authority; digest only. Future verified setup consumes inside its setup transaction. Provider session alone is insufficient.';

create function public.reserve_invitation_resend(p_operation_id uuid,p_invitation_id uuid,p_expected_version bigint,p_requester_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare invitation public.invitations; attempt public.invitation_send_attempts; fresh boolean := false;
begin
 if p_operation_id is null or p_invitation_id is null or p_expected_version is null
  or p_expected_version<1 or p_expected_version>=9007199254740991 then return jsonb_build_object('code','invalid_input'); end if;
 if not exists(select 1 from public.memberships where user_id=p_requester_id and role='admin' and status='active') then return jsonb_build_object('code','denied'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select * into invitation from public.invitations where id=p_invitation_id for update;
 if not found then return jsonb_build_object('code','conflict'); end if;
 select * into attempt from public.invitation_send_attempts where id=p_operation_id for update;
 if found then
  if attempt.kind<>'resend' or attempt.invitation_id<>p_invitation_id or attempt.invitation_version<>p_expected_version+1
   or attempt.requested_by_user_id<>p_requester_id then return jsonb_build_object('code','conflict'); end if;
 else
  if invitation.version<>p_expected_version or invitation.status not in ('pending_issuance','issued','setup_verified','password_established') then return jsonb_build_object('code','stale'); end if;
  select * into attempt from public.invitation_send_attempts where invitation_id=invitation.id and invitation_version=invitation.version for update;
  if not found then return jsonb_build_object('code','conflict'); end if;
  if coalesce(attempt.reconciled_outcome::text,attempt.outcome::text) not in ('accepted','rejected') then return jsonb_build_object('code','pending_reconciliation'); end if;
  if invitation.auth_user_id is null or exists(select 1 from public.memberships where user_id=invitation.auth_user_id)
   or not exists(select 1 from auth.users u where u.id=invitation.auth_user_id and u.banned_until is null
    and translate(u.email collate "C",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=invitation.recipient_email_key) then return jsonb_build_object('code','conflict'); end if;
  delete from public.invitation_send_proofs p using public.invitation_send_attempts a where p.attempt_id=a.id and a.invitation_id=invitation.id;
  update public.invitations set version=version+1,status='pending_issuance',verified_user_id=null,verified_at=null,
   setup_authorization_id=null,password_established_at=null,updated_at=clock_timestamp() where id=invitation.id returning * into invitation;
  insert into public.invitation_send_attempts(id,invitation_id,invitation_version,requested_by_user_id,kind)
   values(p_operation_id,invitation.id,invitation.version,p_requester_id,'resend') returning * into attempt;
  fresh := true;
 end if;
 return jsonb_build_object('code','reserved','invitation_id',invitation.id,'attempt_id',attempt.id,'version',attempt.invitation_version,
  'recipient_email',invitation.recipient_email,'subject_id',invitation.auth_user_id,'fresh',fresh,'outcome',attempt.outcome,'resolution',attempt.reconciled_outcome);
exception when unique_violation then return jsonb_build_object('code','conflict');
end;
$$;

create function public.prepare_invitation_send_proof(p_attempt_id uuid,p_expected_version bigint,p_requester_id uuid,p_subject_id uuid,p_secret_digest text,p_transport text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare invitation public.invitations; attempt public.invitation_send_attempts; proof public.invitation_send_proofs; invitation_id uuid;
begin
 if not exists(select 1 from public.memberships where user_id=p_requester_id and role='admin' and status='active') then return jsonb_build_object('code','denied'); end if;
 if p_subject_id is null or p_secret_digest is null or p_secret_digest collate "C" !~ '^[0-9a-f]{64}$'
  or p_transport is null or p_transport not in ('invite','recovery') then return jsonb_build_object('code','conflict'); end if;
 select a.invitation_id into invitation_id from public.invitation_send_attempts a where a.id=p_attempt_id;
 select * into invitation from public.invitations where id=invitation_id for update;
 if not found then return jsonb_build_object('code','conflict'); end if;
 select * into attempt from public.invitation_send_attempts where id=p_attempt_id for update;
 if p_expected_version is null or attempt.invitation_version<>p_expected_version or invitation.version<>p_expected_version
  or invitation.status<>'pending_issuance' then return jsonb_build_object('code','stale'); end if;
 if attempt.kind<>'resend' or attempt.outcome<>'started' or attempt.reconciled_outcome is not null
  or attempt.requested_by_user_id<>p_requester_id or invitation.auth_user_id is distinct from p_subject_id
  or exists(select 1 from public.memberships where user_id=p_subject_id)
  or not exists(select 1 from auth.users u where u.id=p_subject_id and u.banned_until is null
   and translate(u.email collate "C",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=invitation.recipient_email_key
   and ((p_transport='invite' and u.email_confirmed_at is null) or (p_transport='recovery' and u.email_confirmed_at is not null))) then return jsonb_build_object('code','conflict'); end if;
 select * into proof from public.invitation_send_proofs where attempt_id=p_attempt_id;
 if found then
  if proof.secret_digest<>p_secret_digest or proof.transport<>p_transport or proof.consumed_at is not null then return jsonb_build_object('code','conflict'); end if;
 else insert into public.invitation_send_proofs(attempt_id,secret_digest,transport) values(p_attempt_id,p_secret_digest,p_transport);
 end if;
 return jsonb_build_object('code','prepared');
end;
$$;

create function public.consume_invitation_send_proof(p_attempt_id uuid,p_expected_version bigint,p_verified_subject uuid,p_secret_digest text,p_transport text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare invitation public.invitations; attempt public.invitation_send_attempts; proof public.invitation_send_proofs; invitation_id uuid;
begin
 select a.invitation_id into invitation_id from public.invitation_send_attempts a where a.id=p_attempt_id;
 select * into invitation from public.invitations where id=invitation_id for update;
 if not found then return jsonb_build_object('code','conflict'); end if;
 select * into attempt from public.invitation_send_attempts where id=p_attempt_id for update;
 if p_expected_version is null or attempt.invitation_version<>p_expected_version or invitation.version<>p_expected_version
  or invitation.status<>'issued' then return jsonb_build_object('code','stale'); end if;
 select * into proof from public.invitation_send_proofs where attempt_id=p_attempt_id for update;
 if not found or attempt.kind<>'resend' or coalesce(attempt.reconciled_outcome::text,attempt.outcome::text)<>'accepted'
  or p_verified_subject is null or invitation.auth_user_id is distinct from p_verified_subject
  or p_secret_digest is null or proof.secret_digest<>p_secret_digest or p_transport is null or proof.transport<>p_transport
  or proof.consumed_at is not null or exists(select 1 from public.memberships where user_id=p_verified_subject)
  or not exists(select 1 from auth.users u where u.id=p_verified_subject and u.banned_until is null
   and translate(u.email collate "C",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=invitation.recipient_email_key) then return jsonb_build_object('code','conflict'); end if;
 update public.invitation_send_proofs set consumed_at=clock_timestamp() where attempt_id=p_attempt_id;
 return jsonb_build_object('code','consumed');
end;
$$;

create function public.reconcile_invitation_send(p_attempt_id uuid,p_expected_version bigint,p_requester_id uuid,p_outcome text,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare invitation public.invitations; attempt public.invitation_send_attempts; invitation_id uuid; stale boolean;
begin
 if not exists(select 1 from public.memberships where user_id=p_requester_id and role='admin' and status='active') then return jsonb_build_object('code','denied'); end if;
 if p_outcome is null or p_outcome not in ('accepted','rejected') or p_expected_version is null then return jsonb_build_object('code','conflict'); end if;
 select a.invitation_id into invitation_id from public.invitation_send_attempts a where a.id=p_attempt_id;
 select * into invitation from public.invitations where id=invitation_id for update;
 if not found then return jsonb_build_object('code','conflict'); end if;
 select * into attempt from public.invitation_send_attempts where id=p_attempt_id for update;
 if attempt.invitation_version<>p_expected_version or attempt.outcome not in ('started','unknown')
  or (attempt.kind='initial' and p_subject_id is not null and p_subject_id<>p_attempt_id)
  or (attempt.kind='resend' and invitation.auth_user_id is distinct from p_subject_id)
  or (p_outcome='accepted' and p_subject_id is null) then return jsonb_build_object('code','conflict'); end if;
 stale := invitation.version<>p_expected_version or invitation.status not in ('pending_issuance','issued');
 if attempt.reconciled_outcome is not null then
  if attempt.reconciled_outcome::text<>p_outcome then return jsonb_build_object('code','conflict'); end if;
  return jsonb_build_object('code',case when stale then 'stale' else 'reconciled' end);
 end if;
 if not stale and p_outcome='accepted' then
  if exists(select 1 from public.memberships where user_id=p_subject_id)
   or (invitation.auth_user_id is not null and invitation.auth_user_id<>p_subject_id)
   or not exists(select 1 from auth.users u where u.id=p_subject_id and u.banned_until is null
    and translate(u.email collate "C",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=invitation.recipient_email_key
    and (invitation.auth_user_id is not null or u.email_confirmed_at is null))
   or (attempt.kind='resend' and not exists(select 1 from public.invitation_send_proofs where attempt_id=p_attempt_id)) then return jsonb_build_object('code','conflict'); end if;
  update public.invitations set auth_user_id=p_subject_id,status='issued',updated_at=clock_timestamp() where id=invitation.id;
 end if;
 update public.invitation_send_attempts set reconciled_outcome=p_outcome::public.invitation_send_resolution,reconciled_at=clock_timestamp() where id=p_attempt_id;
 return jsonb_build_object('code',case when stale then 'stale' else 'reconciled' end);
exception when unique_violation then return jsonb_build_object('code','conflict');
end;
$$;

create or replace function public.record_invitation_send_outcome(p_attempt_id uuid,p_expected_version bigint,p_outcome text,p_subject_id uuid,p_error_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare invitation public.invitations; attempt public.invitation_send_attempts; invitation_id uuid; stale boolean;
begin
 if p_outcome is null or p_outcome not in ('accepted','rejected','unknown') or p_expected_version is null
  or (p_error_code is not null and p_error_code not in ('timeout','provider_rejected','rate_limited','provider_unavailable','identity_conflict','unknown'))
  or (p_outcome='accepted' and p_error_code is not null) then return jsonb_build_object('code','conflict'); end if;
 select a.invitation_id into invitation_id from public.invitation_send_attempts a where a.id=p_attempt_id;
 select * into invitation from public.invitations where id=invitation_id for update;
 if not found then return jsonb_build_object('code','conflict'); end if;
 select * into attempt from public.invitation_send_attempts where id=p_attempt_id for update;
 if attempt.invitation_version<>p_expected_version
  or (attempt.kind='initial' and p_subject_id is not null and p_subject_id<>p_attempt_id)
  or (attempt.kind='resend' and invitation.auth_user_id is distinct from p_subject_id)
  or (p_outcome='accepted' and (p_subject_id is null or invitation.auth_user_id is distinct from p_subject_id)) then return jsonb_build_object('code','conflict'); end if;
 stale := invitation.version<>p_expected_version or invitation.status not in ('pending_issuance','issued');
 if attempt.reconciled_outcome is not null then
  if attempt.reconciled_outcome::text<>p_outcome then return jsonb_build_object('code','conflict'); end if;
  return jsonb_build_object('code',case when stale then 'stale' else 'recorded' end);
 end if;
 if attempt.outcome<>'started' then
  if attempt.outcome::text<>p_outcome or attempt.provider_error_code is distinct from p_error_code then return jsonb_build_object('code','conflict'); end if;
  return jsonb_build_object('code',case when stale then 'stale' else 'recorded' end);
 end if;
 if not stale and p_outcome='accepted' and attempt.kind='resend'
  and not exists(select 1 from public.invitation_send_proofs where attempt_id=p_attempt_id) then return jsonb_build_object('code','conflict'); end if;
 update public.invitation_send_attempts set outcome=p_outcome::public.invitation_send_outcome,provider_error_code=p_error_code,completed_at=clock_timestamp() where id=p_attempt_id;
 if not stale and invitation.status='pending_issuance' and p_outcome='accepted' then
  update public.invitations set status='issued',updated_at=clock_timestamp() where id=invitation.id;
 end if;
 return jsonb_build_object('code',case when stale then 'stale' else 'recorded' end);
end;
$$;

revoke all on function public.reserve_invitation_resend(uuid,uuid,bigint,uuid),
 public.prepare_invitation_send_proof(uuid,bigint,uuid,uuid,text,text),
 public.consume_invitation_send_proof(uuid,bigint,uuid,text,text),
 public.reconcile_invitation_send(uuid,bigint,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_invitation_resend(uuid,uuid,bigint,uuid),
 public.prepare_invitation_send_proof(uuid,bigint,uuid,uuid,text,text),
 public.consume_invitation_send_proof(uuid,bigint,uuid,text,text),
 public.reconcile_invitation_send(uuid,bigint,uuid,text,uuid) to service_role;
comment on function public.reconcile_invitation_send(uuid,bigint,uuid,text,uuid) is
 'Internal trusted outcome evidence only. Neither identity existence nor timestamps nor an admin-selected browser outcome is a receipt.';
commit;
