-- VOLO-157. Recovery authority never grants invitation setup or membership.
begin;
create table public.password_recovery_authorizations (
 lookup_digest text primary key check (lookup_digest collate "C" ~ '^[a-f0-9]{64}$'),
 subject uuid not null unique references auth.users(id) on delete cascade,
 email_key text not null, session_id uuid not null,
 origin text not null check (length(origin) between 1 and 512),
 created_at timestamptz not null, expires_at timestamptz not null, consumed_at timestamptz,
 check (expires_at=created_at+interval '30 minutes')
);
create index password_recovery_expiry on public.password_recovery_authorizations(expires_at);
alter table public.password_recovery_authorizations enable row level security;
revoke all on public.password_recovery_authorizations from public,anon,authenticated,service_role;

create function public.record_password_recovery(p_digest text,p_subject uuid,p_email text,p_session_id uuid,p_origin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t timestamptz:=clock_timestamp();
begin
 if p_digest is null or p_digest collate "C" !~ '^[a-f0-9]{64}$' or p_origin is null or length(p_origin) not between 1 and 512
  or not exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id
   where u.id=p_subject and s.id=p_session_id and (s.not_after is null or s.not_after>t)
    and u.email_confirmed_at is not null and u.is_anonymous is not true and (u.banned_until is null or u.banned_until<=t)
    and translate(u.email collate "C",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')=translate(p_email collate "C",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'))
  then return jsonb_build_object('code','denied'); end if;
 delete from public.password_recovery_authorizations where expires_at<=t;
 insert into public.password_recovery_authorizations(lookup_digest,subject,email_key,session_id,origin,created_at,expires_at)
  values(p_digest,p_subject,translate(p_email collate "C",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),p_session_id,p_origin,t,t+interval '30 minutes')
  on conflict(subject) do update set lookup_digest=excluded.lookup_digest,email_key=excluded.email_key,session_id=excluded.session_id,
   origin=excluded.origin,created_at=excluded.created_at,expires_at=excluded.expires_at,consumed_at=null;
 return jsonb_build_object('code','recorded');
end;
$$;
create function public.read_password_recovery(p_digest text,p_subject uuid,p_email text,p_session_id uuid,p_origin text)
returns jsonb language sql security definer set search_path = '' as $$
 select jsonb_build_object('code',case when exists(select 1 from public.password_recovery_authorizations r
  join auth.users u on u.id=r.subject join auth.sessions s on s.id=r.session_id and s.user_id=r.subject
  where r.lookup_digest=p_digest and r.subject=p_subject and r.session_id=p_session_id and r.origin=p_origin
   and r.consumed_at is null and r.expires_at>clock_timestamp() and (s.not_after is null or s.not_after>clock_timestamp())
   and u.email_confirmed_at is not null and u.is_anonymous is not true and (u.banned_until is null or u.banned_until<=clock_timestamp())
   and r.email_key=translate(p_email collate "C",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')
   and r.email_key=translate(u.email collate "C",'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'))then 'authorized' else 'denied' end);
$$;
create function public.claim_password_recovery(p_digest text,p_subject uuid,p_email text,p_session_id uuid,p_origin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from public.password_recovery_authorizations where lookup_digest=p_digest for update;
 if public.read_password_recovery(p_digest,p_subject,p_email,p_session_id,p_origin)->>'code'<>'authorized' then return jsonb_build_object('code','denied'); end if;
 update public.password_recovery_authorizations set consumed_at=clock_timestamp() where lookup_digest=p_digest;
 return jsonb_build_object('code','claimed');
end;
$$;
create function public.cleanup_password_recovery() returns void language sql security definer set search_path = '' as $$
 delete from public.password_recovery_authorizations where expires_at<=clock_timestamp();
$$;
revoke all on function public.record_password_recovery(text,uuid,text,uuid,text),public.read_password_recovery(text,uuid,text,uuid,text),
 public.claim_password_recovery(text,uuid,text,uuid,text),public.cleanup_password_recovery() from public,anon,authenticated;
grant execute on function public.record_password_recovery(text,uuid,text,uuid,text),public.read_password_recovery(text,uuid,text,uuid,text),
 public.claim_password_recovery(text,uuid,text,uuid,text),public.cleanup_password_recovery() to service_role;
select cron.schedule('volo-password-recovery-cleanup','*/5 * * * *','select public.cleanup_password_recovery()');
comment on table public.password_recovery_authorizations is 'Digest-only 30-minute recovery authority. Bound to verified user, email, Auth session and origin; consumed before one password write. Never invitation authority.';
commit;
