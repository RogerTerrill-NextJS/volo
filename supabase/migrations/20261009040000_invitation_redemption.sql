-- VOLO-152: Auth/password network operations remain outside this transaction.
begin;
create function public.redeem_invitation(
 p_invitation_id uuid, p_expected_version bigint, p_setup_authorization_id uuid,
 p_setup_digest text, p_subject uuid, p_email text, p_session_id uuid, p_origin text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 invitation public.invitations;
 authority public.invitation_setup_authorizations;
 redemption_time timestamptz;
begin
 if p_invitation_id is null or p_expected_version is null or p_expected_version<1
  or p_setup_authorization_id is null or p_subject is null or p_session_id is null
  or p_setup_digest is null or p_setup_digest collate "C" !~ '^[a-f0-9]{64}$'
  or p_email is null or octet_length(p_email) not between 1 and 254
  or p_origin is null or length(p_origin) not between 1 and 512
  then return jsonb_build_object('code','denied'); end if;

 -- Same lock order as renewal, setup creation and expiry cleanup.
 select * into invitation from public.invitations where id=p_invitation_id for update;
 if not found or invitation.version<>p_expected_version
  or invitation.status not in ('setup_verified','password_established','redeemed')
  then return jsonb_build_object('code','conflict'); end if;
 if invitation.auth_user_id is distinct from p_subject
  or invitation.verified_user_id is distinct from p_subject
  or invitation.setup_authorization_id is distinct from p_setup_authorization_id
  or invitation.recipient_email_key is distinct from translate(p_email collate "C",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')
  then return jsonb_build_object('code','denied'); end if;

 select * into authority from public.invitation_setup_authorizations
  where id=p_setup_authorization_id for update;
 if not found or authority.invitation_id is distinct from invitation.id
  or authority.invitation_version is distinct from invitation.version
  or authority.lookup_digest is distinct from p_setup_digest
  or authority.verified_user_id is distinct from p_subject
  or authority.session_id is distinct from p_session_id
  or authority.origin is distinct from p_origin
  or authority.expires_at<=clock_timestamp()
  then return jsonb_build_object('code','denied'); end if;
 if not exists(select 1 from auth.users u where u.id=p_subject
   and (u.banned_until is null or u.banned_until<=clock_timestamp())
   and u.is_anonymous is not true and u.email_confirmed_at is not null
   and translate(u.email collate "C",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=invitation.recipient_email_key)
  or not exists(select 1 from auth.sessions s where s.id=p_session_id and s.user_id=p_subject
   and (s.not_after is null or s.not_after>clock_timestamp()))
  then return jsonb_build_object('code','denied'); end if;
 if invitation.password_established_at is null or invitation.verified_at is null
  then return jsonb_build_object('code','denied'); end if;

 -- Historical completion only: never grants current access or changes membership.
 -- Existing setup readers reject redeemed rows; cleanup preserves their snapshot.
 if invitation.status='redeemed' then return jsonb_build_object('code','already_redeemed'); end if;
 if invitation.status<>'password_established'
  or exists(select 1 from public.memberships where user_id=p_subject)
  then return jsonb_build_object('code','denied'); end if;

 insert into public.memberships(user_id,role,status) values(p_subject,'member','active');
 redemption_time:=greatest(clock_timestamp(),invitation.password_established_at,invitation.updated_at);
 update public.invitations set status='redeemed',redeemed_at=redemption_time,updated_at=redemption_time
  where id=invitation.id;
 return jsonb_build_object('code','redeemed');
 -- A concurrent membership insertion wins without being overwritten. This block's
 -- preceding writes roll back before returning a handled uniqueness failure.
exception when unique_violation then return jsonb_build_object('code','denied');
end;
$$;
revoke all on function public.redeem_invitation(uuid,bigint,uuid,text,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.redeem_invitation(uuid,bigint,uuid,text,uuid,text,uuid,text) to service_role;
comment on function public.redeem_invitation(uuid,bigint,uuid,text,uuid,text,uuid,text) is
 'Server-only atomic member creation and redemption. Requires current session-bound setup and recorded password success. Completed retries never change current membership.';
commit;
