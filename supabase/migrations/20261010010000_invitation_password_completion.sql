-- VOLO-124: short persistence operations; no external Auth call holds a lock.
begin;
alter table public.invitation_setup_authorizations
 add column password_operation_id uuid,
 add column password_started_at timestamptz,
 add constraint invitation_password_reservation_pair check
  ((password_operation_id is null)=(password_started_at is null));

create function public.begin_invitation_completion(
 p_operation_id uuid,p_setup_digest text,p_subject uuid,p_email text,p_session_id uuid,p_origin text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 invitation_id uuid;
 invitation public.invitations;
 authority public.invitation_setup_authorizations;
 completion_code text;
begin
 if p_operation_id is null or p_subject is null or p_session_id is null
  or p_setup_digest is null or p_setup_digest collate "C" !~ '^[a-f0-9]{64}$'
  or p_email is null or octet_length(p_email) not between 1 and 254
  or p_origin is null or length(p_origin) not between 1 and 512
  then return jsonb_build_object('code','denied'); end if;
 -- Lookup takes no authority lock. Renewal/cleanup use invitation-first order.
 select a.invitation_id into invitation_id from public.invitation_setup_authorizations a where a.lookup_digest=p_setup_digest;
 if not found then return jsonb_build_object('code','denied'); end if;
 select * into invitation from public.invitations where id=invitation_id for update;
 if not found or invitation.status not in ('setup_verified','password_established','redeemed')
  then return jsonb_build_object('code','denied'); end if;
 select * into authority from public.invitation_setup_authorizations where id=invitation.setup_authorization_id for update;
 if not found or authority.invitation_id is distinct from invitation.id
  or authority.invitation_version is distinct from invitation.version
  or authority.lookup_digest is distinct from p_setup_digest
  or authority.verified_user_id is distinct from p_subject
  or authority.session_id is distinct from p_session_id
  or authority.origin is distinct from p_origin
  or authority.expires_at<=clock_timestamp()
  then return jsonb_build_object('code','denied'); end if;
 if invitation.auth_user_id is distinct from p_subject
  or invitation.verified_user_id is distinct from p_subject
  or invitation.recipient_email_key is distinct from translate(p_email collate "C",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')
  or invitation.verified_at is null
  then return jsonb_build_object('code','denied'); end if;
 if not exists(select 1 from auth.users u where u.id=p_subject
   and (u.banned_until is null or u.banned_until<=clock_timestamp())
   and u.is_anonymous is not true and u.email_confirmed_at is not null
   and translate(u.email collate "C",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=invitation.recipient_email_key)
  or not exists(select 1 from auth.sessions s where s.id=p_session_id and s.user_id=p_subject
   and (s.not_after is null or s.not_after>clock_timestamp()))
  then return jsonb_build_object('code','denied'); end if;
 if invitation.status in ('password_established','redeemed') then
  if invitation.password_established_at is null then return jsonb_build_object('code','denied'); end if;
  completion_code:=invitation.status;
 else
  if exists(select 1 from public.memberships where user_id=p_subject) then return jsonb_build_object('code','denied'); end if;
  if authority.password_operation_id is not null then
   -- Thirty seconds changes presentation only, never grants another mutation.
   return jsonb_build_object('code',case when authority.password_started_at>clock_timestamp()-interval '30 seconds' then 'busy' else 'renew_required' end);
  end if;
  update public.invitation_setup_authorizations set password_operation_id=p_operation_id,password_started_at=clock_timestamp() where id=authority.id;
  completion_code:='reserved';
 end if;
 return jsonb_build_object('code',completion_code,'invitationId',invitation.id,'version',invitation.version,'authorizationId',authority.id);
end;
$$;

create function public.record_invitation_password(
 p_operation_id uuid,p_invitation_id uuid,p_expected_version bigint,p_setup_authorization_id uuid,
 p_setup_digest text,p_subject uuid,p_email text,p_session_id uuid,p_origin text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 invitation public.invitations;
 authority public.invitation_setup_authorizations;
 password_time timestamptz;
begin
 if p_operation_id is null or p_subject is null or p_session_id is null
  or p_setup_digest is null or p_setup_digest collate "C" !~ '^[a-f0-9]{64}$'
  or p_email is null or octet_length(p_email) not between 1 and 254
  or p_origin is null or length(p_origin) not between 1 and 512
  or p_invitation_id is null or p_expected_version is null or p_expected_version<1 or p_setup_authorization_id is null
  then return jsonb_build_object('code','denied'); end if;
 select * into invitation from public.invitations where id=p_invitation_id for update;
 if not found or invitation.version is distinct from p_expected_version
  or invitation.setup_authorization_id is distinct from p_setup_authorization_id
  or invitation.status not in ('setup_verified','password_established','redeemed')
  then return jsonb_build_object('code','denied'); end if;
 select * into authority from public.invitation_setup_authorizations where id=p_setup_authorization_id for update;
 if not found or authority.invitation_id is distinct from invitation.id
  or authority.invitation_version is distinct from invitation.version
  or authority.lookup_digest is distinct from p_setup_digest
  or authority.verified_user_id is distinct from p_subject
  or authority.session_id is distinct from p_session_id
  or authority.origin is distinct from p_origin
  or authority.expires_at<=clock_timestamp()
  then return jsonb_build_object('code','denied'); end if;
 if invitation.auth_user_id is distinct from p_subject
  or invitation.verified_user_id is distinct from p_subject
  or invitation.recipient_email_key is distinct from translate(p_email collate "C",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')
  or invitation.verified_at is null
  then return jsonb_build_object('code','denied'); end if;
 if not exists(select 1 from auth.users u where u.id=p_subject
   and (u.banned_until is null or u.banned_until<=clock_timestamp())
   and u.is_anonymous is not true and u.email_confirmed_at is not null
   and translate(u.email collate "C",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=invitation.recipient_email_key)
  or not exists(select 1 from auth.sessions s where s.id=p_session_id and s.user_id=p_subject
   and (s.not_after is null or s.not_after>clock_timestamp()))
  then return jsonb_build_object('code','denied'); end if;
 if authority.password_operation_id is distinct from p_operation_id or authority.password_started_at is null
  then return jsonb_build_object('code','denied'); end if;
 -- Lost record responses reconcile without clearing or downgrading evidence.
 if invitation.status in ('password_established','redeemed') and invitation.password_established_at is not null
  then return jsonb_build_object('code','recorded'); end if;
 if invitation.status<>'setup_verified' or invitation.password_established_at is not null
  or exists(select 1 from public.memberships where user_id=p_subject)
  then return jsonb_build_object('code','denied'); end if;
 password_time:=greatest(clock_timestamp(),invitation.verified_at,invitation.updated_at,authority.password_started_at);
 update public.invitations set status='password_established',password_established_at=password_time,updated_at=password_time where id=invitation.id;
 return jsonb_build_object('code','recorded');
end;
$$;

create function public.release_invitation_password(
 p_operation_id uuid,p_invitation_id uuid,p_expected_version bigint,p_setup_authorization_id uuid,
 p_setup_digest text,p_subject uuid,p_email text,p_session_id uuid,p_origin text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 invitation public.invitations;
 authority public.invitation_setup_authorizations;
begin
 if p_operation_id is null or p_subject is null or p_session_id is null
  or p_setup_digest is null or p_setup_digest collate "C" !~ '^[a-f0-9]{64}$'
  or p_email is null or octet_length(p_email) not between 1 and 254
  or p_origin is null or length(p_origin) not between 1 and 512
  or p_invitation_id is null or p_expected_version is null or p_expected_version<1 or p_setup_authorization_id is null
  then return jsonb_build_object('code','denied'); end if;
 select * into invitation from public.invitations where id=p_invitation_id for update;
 if not found or invitation.version is distinct from p_expected_version
  or invitation.setup_authorization_id is distinct from p_setup_authorization_id
  or invitation.status not in ('setup_verified','password_established','redeemed')
  then return jsonb_build_object('code','denied'); end if;
 select * into authority from public.invitation_setup_authorizations where id=p_setup_authorization_id for update;
 if not found or authority.invitation_id is distinct from invitation.id
  or authority.invitation_version is distinct from invitation.version
  or authority.lookup_digest is distinct from p_setup_digest
  or authority.verified_user_id is distinct from p_subject
  or authority.session_id is distinct from p_session_id
  or authority.origin is distinct from p_origin
  or authority.expires_at<=clock_timestamp()
  then return jsonb_build_object('code','denied'); end if;
 if invitation.auth_user_id is distinct from p_subject
  or invitation.verified_user_id is distinct from p_subject
  or invitation.recipient_email_key is distinct from translate(p_email collate "C",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')
  or invitation.verified_at is null
  then return jsonb_build_object('code','denied'); end if;
 if not exists(select 1 from auth.users u where u.id=p_subject
   and (u.banned_until is null or u.banned_until<=clock_timestamp())
   and u.is_anonymous is not true and u.email_confirmed_at is not null
   and translate(u.email collate "C",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=invitation.recipient_email_key)
  or not exists(select 1 from auth.sessions s where s.id=p_session_id and s.user_id=p_subject
   and (s.not_after is null or s.not_after>clock_timestamp()))
  then return jsonb_build_object('code','denied'); end if;
 if authority.password_operation_id is distinct from p_operation_id or authority.password_started_at is null
  then return jsonb_build_object('code','denied'); end if;
 -- Lost record responses reconcile without clearing or downgrading evidence.
 if invitation.status in ('password_established','redeemed') and invitation.password_established_at is not null
  then return jsonb_build_object('code','recorded'); end if;
 if invitation.status<>'setup_verified' or invitation.password_established_at is not null
  or exists(select 1 from public.memberships where user_id=p_subject)
  then return jsonb_build_object('code','denied'); end if;
 update public.invitation_setup_authorizations set password_operation_id=null,password_started_at=null where id=authority.id;
 return jsonb_build_object('code','released');
end;
$$;
revoke all on function public.begin_invitation_completion(uuid,text,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.begin_invitation_completion(uuid,text,uuid,text,uuid,text) to service_role;
revoke all on function public.record_invitation_password(uuid,uuid,bigint,uuid,text,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.record_invitation_password(uuid,uuid,bigint,uuid,text,uuid,text,uuid,text) to service_role;
revoke all on function public.release_invitation_password(uuid,uuid,bigint,uuid,text,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.release_invitation_password(uuid,uuid,bigint,uuid,text,uuid,text,uuid,text) to service_role;
commit;
