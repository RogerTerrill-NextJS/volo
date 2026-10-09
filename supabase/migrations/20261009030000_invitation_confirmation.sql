-- VOLO-122. Provider verification is outside these short trusted transactions.
begin;
create extension if not exists pg_cron with schema pg_catalog;

create table public.invitation_confirmation_transports (
 lookup_digest text primary key check (lookup_digest collate "C" ~ '^[a-f0-9]{64}$'),
 csrf_digest text not null check (csrf_digest collate "C" ~ '^[a-f0-9]{64}$'),
 origin text not null check (length(origin) between 1 and 512),
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
 key_id text not null check (key_id collate "C" ~ '^[A-Za-z0-9_-]{1,32}$'),
 nonce text, ciphertext text, tag text, claimed_at timestamptz,
 check (expires_at>created_at and expires_at<=created_at+interval '10 minutes'),
 check ((claimed_at is null and nonce is not null and length(nonce)=16 and ciphertext is not null and length(ciphertext) between 1 and 2048 and tag is not null and length(tag)=22)
  or (claimed_at is not null and nonce is null and ciphertext is null and tag is null))
);
create index invitation_confirmation_expiry on public.invitation_confirmation_transports(expires_at);
create index invitation_confirmation_rate on public.invitation_confirmation_transports(origin,created_at);
create table public.invitation_setup_authorizations (
 id uuid primary key default gen_random_uuid(),
 lookup_digest text not null unique check (lookup_digest collate "C" ~ '^[a-f0-9]{64}$'),
 invitation_id uuid not null unique references public.invitations(id) on delete restrict,
 invitation_version bigint not null check (invitation_version>0),
 verified_user_id uuid not null references auth.users(id) on delete restrict,
 session_id uuid not null, origin text not null check (length(origin) between 1 and 512),
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
 check (expires_at=created_at+interval '30 minutes')
);
create index invitation_setup_expiry on public.invitation_setup_authorizations(expires_at);
alter table public.invitation_confirmation_transports enable row level security;
alter table public.invitation_setup_authorizations enable row level security;
revoke all on public.invitation_confirmation_transports,public.invitation_setup_authorizations from public,anon,authenticated,service_role;

create function public.cleanup_invitation_confirmation() returns void language plpgsql security definer set search_path = '' as $$
declare expired record;
begin
 delete from public.invitation_confirmation_transports where expires_at<=clock_timestamp();
 for expired in select s.id,s.invitation_id,s.invitation_version from public.invitation_setup_authorizations s
  where s.expires_at<=clock_timestamp() order by s.invitation_id loop
  perform 1 from public.invitations where id=expired.invitation_id for update;
  -- Compare again after the lock: another request may have replaced this grant.
  if exists(select 1 from public.invitation_setup_authorizations where id=expired.id and expires_at<=clock_timestamp()) then
   update public.invitations set status='issued',verified_user_id=null,verified_at=null,
    setup_authorization_id=null,password_established_at=null,updated_at=clock_timestamp()
    where id=expired.invitation_id and version=expired.invitation_version and setup_authorization_id=expired.id
     and status in ('setup_verified','password_established');
   delete from public.invitation_setup_authorizations where id=expired.id;
  end if;
 end loop;
end;
$$;

create function public.create_invitation_confirmation_transport(p_lookup_digest text,p_csrf_digest text,p_origin text,p_expires_at timestamptz,p_key_id text,p_nonce text,p_ciphertext text,p_tag text,p_previous_digest text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare confirmation_time timestamptz := clock_timestamp();
begin
 if p_lookup_digest is null or p_lookup_digest collate "C" !~ '^[a-f0-9]{64}$'
  or p_csrf_digest is null or p_csrf_digest collate "C" !~ '^[a-f0-9]{64}$'
  or p_origin is null or length(p_origin) not between 1 and 512
  or p_expires_at is null or p_expires_at<=confirmation_time or p_expires_at>confirmation_time+interval '10 minutes'
  or p_key_id is null or p_key_id collate "C" !~ '^[A-Za-z0-9_-]{1,32}$'
  or p_nonce is null or p_nonce collate "C" !~ '^[A-Za-z0-9_-]{16}$'
  or p_ciphertext is null or length(p_ciphertext) not between 1 and 2048 or p_ciphertext collate "C" !~ '^[A-Za-z0-9_-]+$'
  or p_tag is null or p_tag collate "C" !~ '^[A-Za-z0-9_-]{22}$' then return jsonb_build_object('code','denied'); end if;
 perform pg_advisory_xact_lock(hashtextextended('volo-confirmation-transports',0));
 delete from public.invitation_confirmation_transports where expires_at<=confirmation_time;
 if (select count(*) from public.invitation_confirmation_transports)>=1024
  or (select count(*) from public.invitation_confirmation_transports where origin=p_origin and created_at>confirmation_time-interval '1 minute')>=60
  then return jsonb_build_object('code','limited'); end if;
 update public.invitation_confirmation_transports set claimed_at=confirmation_time,nonce=null,ciphertext=null,tag=null
  where lookup_digest=p_previous_digest and origin=p_origin and claimed_at is null;
 insert into public.invitation_confirmation_transports(lookup_digest,csrf_digest,origin,created_at,expires_at,key_id,nonce,ciphertext,tag)
  values(p_lookup_digest,p_csrf_digest,p_origin,confirmation_time,p_expires_at,p_key_id,p_nonce,p_ciphertext,p_tag);
 return jsonb_build_object('code','created');
exception when unique_violation then return jsonb_build_object('code','denied');
end;
$$;

create function public.read_invitation_confirmation_transport(p_lookup_digest text,p_origin text)
returns jsonb language sql security definer set search_path = '' as $$
 select coalesce((select jsonb_build_object('code','found','envelope',jsonb_build_object('keyId',key_id,'nonce',nonce,'ciphertext',ciphertext,'tag',tag,'expiresAt',expires_at))
  from public.invitation_confirmation_transports where lookup_digest=p_lookup_digest and origin=p_origin and claimed_at is null and expires_at>clock_timestamp()),jsonb_build_object('code','denied'));
$$;
create function public.claim_invitation_confirmation_transport(p_lookup_digest text,p_csrf_digest text,p_origin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare transport public.invitation_confirmation_transports; result jsonb;
begin
 select * into transport from public.invitation_confirmation_transports where lookup_digest=p_lookup_digest for update;
 if not found or transport.origin is distinct from p_origin or transport.csrf_digest is distinct from p_csrf_digest
  or transport.claimed_at is not null or transport.expires_at<=clock_timestamp() then return jsonb_build_object('code','denied'); end if;
 result:=jsonb_build_object('code','claimed','envelope',jsonb_build_object('keyId',transport.key_id,'nonce',transport.nonce,'ciphertext',transport.ciphertext,'tag',transport.tag,'expiresAt',transport.expires_at));
 update public.invitation_confirmation_transports set claimed_at=clock_timestamp(),nonce=null,ciphertext=null,tag=null where lookup_digest=p_lookup_digest;
 return result;
end;
$$;

create function public.record_verified_invitation_setup(p_subject uuid,p_email text,p_session_id uuid,p_origin text,p_setup_digest text,p_invitation_id uuid,p_expected_version bigint,p_attempt_id uuid,p_resume_digest text,p_transport text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare invitation public.invitations; attempt public.invitation_send_attempts; proof public.invitation_send_proofs;
 authorization_id uuid:=gen_random_uuid(); confirmation_time timestamptz;
begin
 if p_subject is null or p_session_id is null or p_email is null or p_origin is null or length(p_origin) not between 1 and 512
  or p_setup_digest is null or p_setup_digest collate "C" !~ '^[a-f0-9]{64}$' then return jsonb_build_object('code','denied'); end if;
 select * into invitation from public.invitations where id=p_invitation_id for update;
 if not found or p_expected_version is null or invitation.version<>p_expected_version or invitation.status<>'issued' then return jsonb_build_object('code','stale'); end if;
 if invitation.auth_user_id is distinct from p_subject
  or invitation.recipient_email_key<>translate(p_email collate "C",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')
  or exists(select 1 from public.memberships where user_id=p_subject)
  or not exists(select 1 from auth.users u where u.id=p_subject and u.banned_until is null and u.is_anonymous is not true
   and u.email_confirmed_at is not null and translate(u.email collate "C",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=invitation.recipient_email_key)
  or not exists(select 1 from auth.sessions s where s.id=p_session_id and s.user_id=p_subject and (s.not_after is null or s.not_after>clock_timestamp()))
  then return jsonb_build_object('code','denied'); end if;
 select * into attempt from public.invitation_send_attempts where invitation_id=invitation.id and invitation_version=invitation.version for update;
 if not found or coalesce(attempt.reconciled_outcome::text,attempt.outcome::text)<>'accepted' then return jsonb_build_object('code','denied'); end if;
 if attempt.kind='initial' then
  if p_transport is distinct from 'invite' or p_attempt_id is not null or p_resume_digest is not null then return jsonb_build_object('code','denied'); end if;
 else
  select * into proof from public.invitation_send_proofs where attempt_id=attempt.id for update;
  if not found or p_attempt_id is distinct from attempt.id or proof.transport is distinct from p_transport
   or proof.secret_digest is distinct from p_resume_digest or proof.consumed_at is not null then return jsonb_build_object('code','denied'); end if;
  update public.invitation_send_proofs set consumed_at=clock_timestamp() where attempt_id=attempt.id;
 end if;
 confirmation_time:=clock_timestamp();
 delete from public.invitation_setup_authorizations where invitation_id=invitation.id;
 insert into public.invitation_setup_authorizations(id,lookup_digest,invitation_id,invitation_version,verified_user_id,session_id,origin,created_at,expires_at)
  values(authorization_id,p_setup_digest,invitation.id,invitation.version,p_subject,p_session_id,p_origin,confirmation_time,confirmation_time+interval '30 minutes');
 update public.invitations set status='setup_verified',verified_user_id=p_subject,verified_at=confirmation_time,
  setup_authorization_id=authorization_id,password_established_at=null,updated_at=confirmation_time where id=invitation.id;
 return jsonb_build_object('code','recorded','authorizationId',authorization_id,'expiresAt',confirmation_time+interval '30 minutes');
exception when unique_violation then return jsonb_build_object('code','conflict');
end;
$$;

create function public.read_verified_invitation_setup(p_setup_digest text,p_subject uuid,p_email text,p_session_id uuid,p_origin text)
returns jsonb language sql security definer set search_path = '' as $$
 select coalesce((select jsonb_build_object('code','authorized','invitationId',i.id,'version',i.version,'authorizationId',s.id,'expiresAt',s.expires_at)
  from public.invitation_setup_authorizations s join public.invitations i on i.id=s.invitation_id join auth.users u on u.id=s.verified_user_id
  join auth.sessions a on a.id=s.session_id and a.user_id=u.id
  where s.lookup_digest=p_setup_digest and s.verified_user_id=p_subject and s.session_id=p_session_id and s.origin=p_origin
   and s.expires_at>clock_timestamp() and (a.not_after is null or a.not_after>clock_timestamp()) and u.banned_until is null and u.is_anonymous is not true
   and u.email_confirmed_at is not null and i.auth_user_id=p_subject and i.verified_user_id=p_subject
   and i.version=s.invitation_version and i.setup_authorization_id=s.id and i.status in ('setup_verified','password_established')
   and translate(p_email collate "C",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=i.recipient_email_key
   and translate(u.email collate "C",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=i.recipient_email_key
   and not exists(select 1 from public.memberships m where m.user_id=p_subject)),jsonb_build_object('code','denied'));
$$;

-- New functions are never callable with a browser user's privileges.
revoke all on function public.create_invitation_confirmation_transport(text,text,text,timestamptz,text,text,text,text,text),
 public.read_invitation_confirmation_transport(text,text),public.claim_invitation_confirmation_transport(text,text,text),
 public.record_verified_invitation_setup(uuid,text,uuid,text,text,uuid,bigint,uuid,text,text),
 public.read_verified_invitation_setup(text,uuid,text,uuid,text),public.cleanup_invitation_confirmation() from public,anon,authenticated;
grant execute on function public.create_invitation_confirmation_transport(text,text,text,timestamptz,text,text,text,text,text),
 public.read_invitation_confirmation_transport(text,text),public.claim_invitation_confirmation_transport(text,text,text),
 public.record_verified_invitation_setup(uuid,text,uuid,text,text,uuid,bigint,uuid,text,text),
 public.read_verified_invitation_setup(text,uuid,text,uuid,text),public.cleanup_invitation_confirmation() to service_role;
select cron.schedule('volo-invitation-confirmation-cleanup','*/5 * * * *','select public.cleanup_invitation_confirmation()');
comment on table public.invitation_confirmation_transports is 'Encrypted 10-minute confirmation material; claimed payload erased, rate tombstone expires. Cron purges idle expiry.';
comment on table public.invitation_setup_authorizations is 'Digest-only 30-minute authority bound to verified Auth session and current invitation generation. Never membership.';
commit;
