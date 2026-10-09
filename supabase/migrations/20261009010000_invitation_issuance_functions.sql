-- VOLO-148: trusted server operations; caller IDs come from fresh Auth verification.
begin;
create function public.reserve_invitation_send(p_operation_id uuid,p_recipient_email text,p_requester_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 email text := btrim(p_recipient_email,' '||chr(9)||chr(10)||chr(11)||chr(12)||chr(13));
 email_key text;
 invitation public.invitations;
 attempt public.invitation_send_attempts;
 fresh boolean := false;
begin
 if p_operation_id is null or email is null or octet_length(email) not between 3 and 254
  or octet_length(email) <> char_length(email) or email collate "C" !~ '^[!-~]+@[!-~]+$'
  or length(email)-length(replace(email,'@','')) <> 1 then
  return jsonb_build_object('code','invalid_input');
 end if;
 if not exists(select 1 from public.memberships where user_id=p_requester_id and role='admin' and status='active') then
  return jsonb_build_object('code','denied');
 end if;
 email_key := translate(email collate "C",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz');
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select * into attempt from public.invitation_send_attempts where id=p_operation_id;
 if found then
  select * into invitation from public.invitations where id=attempt.invitation_id;
  if attempt.requested_by_user_id <> p_requester_id or attempt.kind <> 'initial'
   or invitation.recipient_email_key <> email_key then
   return jsonb_build_object('code','conflict');
  end if;
 else
  if exists(select 1 from auth.users email_address where id=p_operation_id or
   translate(btrim(email_address.email collate "C",' '||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=email_key
   -- Alias keeps the provider column distinct from the local input variable.
   ) then
   return jsonb_build_object('code','conflict');
  end if;
  insert into public.invitations(recipient_email,invited_by_user_id)
   values(email,p_requester_id) returning * into invitation;
  insert into public.invitation_send_attempts(id,invitation_id,invitation_version,requested_by_user_id,kind)
   values(p_operation_id,invitation.id,1,p_requester_id,'initial') returning * into attempt;
  fresh := true;
 end if;
 return jsonb_build_object('code','reserved','invitation_id',invitation.id,'attempt_id',attempt.id,
  'version',attempt.invitation_version,'recipient_email',invitation.recipient_email,'fresh',fresh,'outcome',attempt.outcome);
exception when unique_violation then
 return jsonb_build_object('code','conflict');
end;
$$;

create function public.bind_invitation_send_subject(p_attempt_id uuid,p_expected_version bigint,p_requester_id uuid,p_subject_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare invitation public.invitations; attempt public.invitation_send_attempts; invitation_id uuid;
begin
 if not exists(select 1 from public.memberships where user_id=p_requester_id and role='admin' and status='active') then
  return jsonb_build_object('code','denied');
 end if;
 select a.invitation_id into invitation_id from public.invitation_send_attempts a where a.id=p_attempt_id;
 select * into invitation from public.invitations where id=invitation_id for update;
 if not found then return jsonb_build_object('code','conflict'); end if;
 select * into attempt from public.invitation_send_attempts where id=p_attempt_id for update;
 if p_expected_version is null or attempt.invitation_version<>p_expected_version
  or invitation.version<>p_expected_version or invitation.status<>'pending_issuance' then
  return jsonb_build_object('code','stale');
 end if;
 if p_subject_id is null or p_subject_id<>p_attempt_id or attempt.requested_by_user_id<>p_requester_id
  or attempt.kind<>'initial' or attempt.outcome<>'started'
  or (invitation.auth_user_id is not null and invitation.auth_user_id<>p_subject_id)
  or exists(select 1 from public.memberships where user_id=p_subject_id)
  or not exists(select 1 from auth.users u where u.id=p_subject_id and
   translate(u.email collate "C",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=invitation.recipient_email_key
   and u.email_confirmed_at is null and u.banned_until is null) then
  return jsonb_build_object('code','conflict');
 end if;
 update public.invitations set auth_user_id=p_subject_id,updated_at=clock_timestamp() where id=invitation.id;
 return jsonb_build_object('code','bound');
exception when unique_violation then return jsonb_build_object('code','conflict');
end;
$$;

create function public.record_invitation_send_outcome(p_attempt_id uuid,p_expected_version bigint,p_outcome text,p_subject_id uuid,p_error_code text)
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
 if attempt.invitation_version<>p_expected_version or attempt.kind<>'initial'
  or (p_subject_id is not null and p_subject_id<>p_attempt_id)
  or (p_outcome='accepted' and (p_subject_id is null or invitation.auth_user_id is distinct from p_subject_id)) then
  return jsonb_build_object('code','conflict');
 end if;
 stale := invitation.version<>p_expected_version or invitation.status not in ('pending_issuance','issued');
 if attempt.outcome<>'started' then
  if attempt.outcome::text<>p_outcome or attempt.provider_error_code is distinct from p_error_code then
   return jsonb_build_object('code','conflict');
  end if;
  return jsonb_build_object('code',case when stale then 'stale' else 'recorded' end);
 end if;
 update public.invitation_send_attempts set outcome=p_outcome::public.invitation_send_outcome,
  provider_error_code=p_error_code,completed_at=clock_timestamp() where id=p_attempt_id;
 if not stale and invitation.status='pending_issuance' and p_outcome='accepted' then
  update public.invitations set status='issued',updated_at=clock_timestamp() where id=invitation.id;
 end if;
 return jsonb_build_object('code',case when stale then 'stale' else 'recorded' end);
end;
$$;

revoke all on function public.reserve_invitation_send(uuid,text,uuid),
 public.bind_invitation_send_subject(uuid,bigint,uuid,uuid),
 public.record_invitation_send_outcome(uuid,bigint,text,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_invitation_send(uuid,text,uuid),
 public.bind_invitation_send_subject(uuid,bigint,uuid,uuid),
 public.record_invitation_send_outcome(uuid,bigint,text,uuid,text) to service_role;
commit;
