-- VOLO-227: verified founder execution; default-off until provider retention is evidenced.
begin;
create schema deletion_private;
revoke all on schema deletion_private from public,anon,authenticated,service_role;
create table deletion_private.policy (
 singleton boolean primary key default true check(singleton),
 retention_verified boolean not null default false,
 evidence_reference text not null default '',
 check(not retention_verified or char_length(btrim(evidence_reference)) between 1 and 160)
);
insert into deletion_private.policy default values;
create table deletion_private.jobs (
 id uuid primary key,
 subject_id uuid not null unique references public.memberships(user_id) on delete restrict,
 verified_by uuid,
 reference text,
 subject_email text,
 verified_at timestamptz not null default clock_timestamp(),
 purge_due_at timestamptz not null,
 photo_after timestamptz,
 phase text not null check(phase in ('closing','photos','auth','retention_pending','purged')),
 completed_at timestamptz,
 purged_at timestamptz,
 check(purge_due_at=verified_at+interval '1440 hours')
);
alter table deletion_private.policy enable row level security;
alter table deletion_private.jobs enable row level security;
revoke all on all tables in schema deletion_private from public,anon,authenticated,service_role;
alter table public.memberships add column deletion_started_at timestamptz;
alter table public.memberships add column deleted_at timestamptz;
alter table public.memberships add constraint membership_deletion_denied check (
 (deletion_started_at is null or status='disabled') and (deleted_at is null or deletion_started_at is not null)
);
create function deletion_private.authorize_admin() returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); begin
 perform 1 from public.memberships where user_id=actor and role='admin' and status='active' for share;
 if not found then raise exception 'Deletion administration denied' using errcode='42501'; end if;
 return actor;
end $$;
create function deletion_private.lock_job(request uuid) returns deletion_private.jobs language plpgsql security definer set search_path='' as $$
declare job deletion_private.jobs; begin
 perform deletion_private.authorize_admin();
 select * into job from deletion_private.jobs where id=request for update;
 if not found then raise exception 'Deletion request unavailable' using errcode='42501'; end if;
 return job;
end $$;
create function public.admin_account_deletion_preview(p_subject_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; target public.memberships; label text; begin
 actor:=deletion_private.authorize_admin();
 if p_subject_id is null or p_subject_id=actor then raise exception 'Deletion target unavailable' using errcode='42501'; end if;
 select * into target from public.memberships where user_id=p_subject_id;
 if not found then raise exception 'Deletion target unavailable' using errcode='42501'; end if;
 select display_name into label from public.profiles where user_id=p_subject_id;
 return jsonb_build_object('subjectId',target.user_id,'displayName',label,'status',target.status,'alreadyStarted',target.deletion_started_at is not null,
 'ownedOpenFlights',(select count(*) from public.flights where owner_id=p_subject_id and status='open'),
 'activeRequests',(select count(*) from public.flight_requests r join public.flights f on f.id=r.flight_id where r.status in('pending','accepted') and (r.requester_id=p_subject_id or f.owner_id=p_subject_id)),
 'conversations',(select count(*) from public.conversations where p_subject_id in(owner_id,requester_id)),
 'photoObjects',(select count(*) from public.profile_photo_objects where owner_id=p_subject_id),
 'storageObjects',(select count(*) from storage.objects where bucket_id in('profile-photo-uploads','profile-photos') and starts_with(name,p_subject_id::text||'/')),
 'retentionDays',60,'policyReady',(select retention_verified from deletion_private.policy));
end $$;
create function public.admin_begin_account_deletion(p_request_id uuid,p_subject_id uuid,p_reference text,p_confirmation uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target public.memberships; job deletion_private.jobs; stamp timestamptz:=clock_timestamp(); begin
 -- Pair locks match member administration, including cross-admin attempts.
 perform 1 from public.memberships where user_id in(actor,p_subject_id) order by user_id for update;
 perform deletion_private.authorize_admin();
 if p_request_id is null or p_subject_id is null or p_confirmation is distinct from p_subject_id or p_reference is null
  or char_length(btrim(p_reference)) not between 1 and 160 then raise exception 'Invalid verified deletion request' using errcode='22023'; end if;
 if actor=p_subject_id then raise exception 'Self execution denied' using errcode='42501'; end if;
 select * into job from deletion_private.jobs where id=p_request_id or subject_id=p_subject_id;
 if found then
  if job.id<>p_request_id or job.subject_id<>p_subject_id or job.reference is distinct from btrim(p_reference) then
   raise exception 'Deletion request conflict' using errcode='22023'; end if;
  return jsonb_build_object('code','already_started','requestId',job.id,'phase',job.phase);
 end if;
 if not exists(select 1 from deletion_private.policy where retention_verified) then
  raise exception 'Deletion retention policy not verified' using errcode='55000'; end if;
 select * into target from public.memberships where user_id=p_subject_id;
 if not found or target.deletion_started_at is not null then raise exception 'Deletion target unavailable' using errcode='42501'; end if;
 if target.role='admin' and target.status='active' and (select count(*) from public.memberships where status='active' and role='admin')<=1 then
  raise exception 'Last administrator deletion denied' using errcode='42501'; end if;
 insert into deletion_private.jobs(id,subject_id,verified_by,reference,subject_email,verified_at,purge_due_at,phase)
 select p_request_id,p_subject_id,actor,btrim(p_reference),lower(email),stamp,stamp+interval '1440 hours','closing' from auth.users where id=p_subject_id and deleted_at is null;
 if not found then raise exception 'Deletion target unavailable' using errcode='42501'; end if;
 update public.memberships set status='disabled',disabled_at=coalesce(disabled_at,stamp),disabled_reason='Account deletion requested',deletion_started_at=stamp where user_id=p_subject_id;
 return jsonb_build_object('code','started','requestId',p_request_id,'phase','closing');
end $$;
create function public.admin_prepare_account_deletion(p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare job deletion_private.jobs; flight public.flights; until_time timestamptz; begin
 job:=deletion_private.lock_job(p_request_id);
 if job.phase<>'closing' then return jsonb_build_object('code',job.phase); end if;
 for flight in select f.* from public.flights f where
  (f.owner_id=job.subject_id and (f.status='open' or exists(select 1 from public.flight_requests r where r.flight_id=f.id and r.status in('pending','accepted'))))
  or exists(select 1 from public.flight_requests r where r.flight_id=f.id and r.requester_id=job.subject_id and r.status in('pending','accepted'))
  or exists(select 1 from public.conversations c join public.flight_requests r on r.id=c.flight_request_id where r.flight_id=f.id and job.subject_id in(c.owner_id,c.requester_id) and c.closed_at is null)
  order by f.id limit 20 for update of f loop
   update public.flight_requests set status=case when flight.owner_id=job.subject_id then 'cancelled'::public.flight_request_status else 'withdrawn'::public.flight_request_status end
    where flight_id=flight.id and status in('pending','accepted') and (flight.owner_id=job.subject_id or requester_id=job.subject_id);
   if flight.owner_id=job.subject_id and flight.status='open' then update public.flights set status='cancelled' where id=flight.id; end if;
   update public.conversations set closed_at=coalesce(closed_at,statement_timestamp()) where flight_request_id in(select id from public.flight_requests where flight_id=flight.id) and job.subject_id in(owner_id,requester_id) and closed_at is null;
 end loop;
 if exists(select 1 from public.flights where owner_id=job.subject_id and status='open') or exists(
  select 1 from public.flight_requests r join public.flights f on f.id=r.flight_id where r.status in('pending','accepted') and (r.requester_id=job.subject_id or f.owner_id=job.subject_id))
  or exists(select 1 from public.conversations where job.subject_id in(owner_id,requester_id) and closed_at is null) then return jsonb_build_object('code','closing'); end if;
 -- Do not retain flight/member locks across the external photo cleanup phase.
 perform 1 from public.profiles where user_id=job.subject_id for update;
 if found then
  select greatest(clock_timestamp()+interval '90 seconds',max(processing_until),max(cleanup_until)) into until_time from public.profile_photo_objects where owner_id=job.subject_id;
  update public.profiles set photo_storage_path=null,photo_revision=photo_revision+1 where user_id=job.subject_id;
  update public.profile_photo_objects set state='obsolete',expires_at=clock_timestamp() where owner_id=job.subject_id;
 else until_time:=clock_timestamp(); end if;
 update public.invitations set status='revoked',version=version+1,revoked_at=greatest(clock_timestamp(),created_at),revoked_by_user_id=auth.uid(),revocation_reason='Account deletion',updated_at=clock_timestamp()
  where (auth_user_id=job.subject_id or verified_user_id=job.subject_id or recipient_email_key=job.subject_email) and status in('pending_issuance','issued','setup_verified','password_established');
 delete from public.invitation_setup_authorizations where verified_user_id=job.subject_id;
 delete from public.password_recovery_authorizations where subject=job.subject_id;
 delete from public.notifications where recipient_id=job.subject_id;
 update deletion_private.jobs set phase='photos',photo_after=until_time where id=job.id;
 return jsonb_build_object('code','photos');
end $$;
create function public.admin_account_deletion_status(p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare job deletion_private.jobs; assets jsonb; begin
 job:=deletion_private.lock_job(p_request_id);
 select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket_id,'path',name)),'[]') into assets from (
  select bucket_id,name from storage.objects where bucket_id in('profile-photo-uploads','profile-photos') and starts_with(name,job.subject_id::text||'/') order by bucket_id,name limit 20
 ) x;
 return jsonb_build_object('requestId',job.id,'subjectId',job.subject_id,'phase',job.phase,'purgeDueAt',job.purge_due_at,
 'ready',job.photo_after is null or job.photo_after<=clock_timestamp(),'assets',case when job.phase='photos' then assets else '[]'::jsonb end,
 'photoPending',(select count(*) from public.profile_photo_objects where owner_id=job.subject_id),
 'overdue',job.purge_due_at<=clock_timestamp() and (job.purged_at is null or job.completed_at is null));
end $$;
create function public.admin_finish_deletion_photos(p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare job deletion_private.jobs; begin
 job:=deletion_private.lock_job(p_request_id);
 if job.phase<>'photos' then return jsonb_build_object('code',job.phase); end if;
 if job.photo_after>clock_timestamp() or exists(select 1 from public.profile_photo_objects where owner_id=job.subject_id)
 or exists(select 1 from storage.objects where bucket_id in('profile-photo-uploads','profile-photos') and starts_with(name,job.subject_id::text||'/')) then
  return jsonb_build_object('code','photos'); end if;
 delete from public.profiles where user_id=job.subject_id;
 update deletion_private.jobs set phase='auth' where id=job.id;
 return jsonb_build_object('code','auth');
end $$;
create function public.admin_complete_account_deletion(p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare job deletion_private.jobs; begin
 job:=deletion_private.lock_job(p_request_id);
 if job.phase in('retention_pending','purged') then return jsonb_build_object('code',job.phase); end if;
 if job.phase<>'auth' or not exists(select 1 from auth.users where id=job.subject_id and deleted_at is not null and coalesce(encrypted_password,'')='' and (job.subject_email is null or lower(email) is distinct from job.subject_email))
  then raise exception 'Auth deletion not confirmed' using errcode='55000'; end if;
 update public.memberships set deleted_at=clock_timestamp() where user_id=job.subject_id;
 update deletion_private.jobs set phase=case when purged_at is null then 'retention_pending' else 'purged' end,completed_at=clock_timestamp() where id=job.id;
 return jsonb_build_object('code',case when job.purged_at is null then 'retention_pending' else 'purged' end);
end $$;
-- Serialize report intake with the target's retention boundary. No private body is copied.
create function deletion_private.report_reason(reporter uuid,kind text,target uuid,input_reason text) returns text language plpgsql security definer set search_path='' as $$
declare job record; expired boolean:=false; begin
 for job in select j.id,j.purge_due_at from deletion_private.jobs j where j.subject_id=reporter
  or (kind='pilot' and j.subject_id=target)
  or (kind='flight' and j.subject_id=(select owner_id from public.flights where id=target))
  or (kind='message' and j.subject_id=(select sender_id from public.messages where id=target))
  order by j.id for update loop
   if job.purge_due_at<=clock_timestamp() then expired:=true; end if;
 end loop;
 return case when expired then 'Retention period ended' else input_reason end;
end $$;
-- The job is an internal scheduler operation; no caller-supplied subject or time.
create function deletion_private.purge_due() returns integer language plpgsql security definer set search_path='' as $$
declare job deletion_private.jobs; n integer:=0; begin
 for job in select * from deletion_private.jobs where purge_due_at<=clock_timestamp() and purged_at is null order by id limit 20 for update skip locked loop
  update public.invitations set recipient_email='deleted-'||id::text||'@example.invalid',revocation_reason=case when revocation_reason is null then null else 'Retention period ended' end,updated_at=greatest(updated_at,clock_timestamp())
   where auth_user_id=job.subject_id or verified_user_id=job.subject_id or recipient_email_key=job.subject_email;
  update public.invitations set revocation_reason='Retention period ended' where revoked_by_user_id=job.subject_id and revocation_reason is not null;
  update public.member_admin_audit set reason='Retention period ended' where actor_id=job.subject_id or target_id=job.subject_id;
  update public.flight_moderation_audit set reason='Retention period ended' where actor_id=job.subject_id or flight_id in(select id from public.flights where owner_id=job.subject_id);
  update public.reports set reason='Retention period ended' where reporter_id=job.subject_id or (target_type='pilot' and target_id=job.subject_id);
  update public.reports set reason='Retention period ended' where (target_type='flight' and target_id in(select id from public.flights where owner_id=job.subject_id)) or (target_type='message' and target_id in(select id from public.messages where sender_id=job.subject_id));
  update deletion_private.jobs set reference=null,subject_email=null,verified_by=null,purged_at=clock_timestamp(),phase=case when completed_at is not null then 'purged' else phase end where id=job.id;
  n:=n+1;
 end loop;
 return n;
end $$;
select cron.schedule('volo-account-deletion-retention','* * * * *','select deletion_private.purge_due()');
-- Preserve report authorization/receipt semantics; normalize expired personal reasons before every comparison.
create or replace function public.submit_report(p_report_id uuid,p_target_type text,p_target_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare viewer uuid:=(select auth.uid()); stored public.reports%rowtype; flight public.flights%rowtype;
 reason text:=btrim(p_reason); permitted boolean:=false;
begin
 if not exists(select 1 from public.memberships where user_id=viewer and status='active') then
  raise exception 'Report intake denied' using errcode='42501';
 end if;
 if p_report_id is null or p_target_id is null or p_target_type is null or p_target_type not in ('pilot','flight','message')
  or reason is null or char_length(reason) not between 1 and 2000 or reason ~ '^[[:space:]]*$' then
  raise exception 'Invalid report input' using errcode='22023';
 end if;
 reason:=deletion_private.report_reason(viewer,p_target_type,p_target_id,reason);
 -- Immutable own receipts remain confirmable after target access changes. A
 -- retry identity never reveals or overwrites a different reporter/payload.
 select * into stored from public.reports where id=p_report_id;
 if found then
  perform 1 from public.memberships where user_id=viewer and status='active' for share;
  if not found then raise exception 'Report intake denied' using errcode='42501'; end if;
  if stored.reporter_id<>viewer or stored.target_type<>p_target_type or stored.target_id<>p_target_id or stored.reason<>reason then
   return jsonb_build_object('code','report_conflict');
  end if;
  return jsonb_build_object('code','already_reported','reportId',stored.id,'targetType',stored.target_type,'targetId',stored.target_id,'createdAt',stored.created_at);
 end if;
 if p_target_type='flight' then
  -- Visibility/removal/hiding uses this same flight lock. Take it before the
  -- current viewer membership lock, preserving the lifecycle lock direction.
  select * into flight from public.flights where id=p_target_id for share;
 elsif p_target_type='pilot' then
  perform 1 from public.memberships where user_id in(viewer,p_target_id) order by user_id for share;
 end if;
 perform 1 from public.memberships where user_id=viewer and status='active' for share;
 if not found then raise exception 'Report intake denied' using errcode='42501'; end if;
 if p_target_type='pilot' then
  select exists(select 1 from public.profiles p join public.memberships m on m.user_id=p.user_id and m.status='active'
   where p.user_id=p_target_id and p.pilot_designation='licensed') into permitted;
 elsif p_target_type='flight' then
  permitted:=flight.id is not null and (flight.moderated_at is null or flight.owner_id=viewer)
   and (flight.visibility='NETWORK' or flight.owner_id=viewer or exists(
    select 1 from public.flight_recipients where flight_id=flight.id and user_id=viewer
   ));
 else
  -- Retained message read entitlement requires the actual participant pair,
  -- not a live connection, an admin role or current PRIVATE-flight selection.
  select exists(select 1 from public.messages m join public.conversations c on c.id=m.conversation_id
   where m.id=p_target_id and viewer in(c.owner_id,c.requester_id)) into permitted;
 end if;
 -- A first receipt lookup can precede another transaction's commit. Recheck
 -- after target/membership waits before rejecting changed target visibility.
 select * into stored from public.reports where id=p_report_id;
 if found then
  if stored.reporter_id<>viewer or stored.target_type<>p_target_type or stored.target_id<>p_target_id or stored.reason<>reason then
   return jsonb_build_object('code','report_conflict');
  end if;
  return jsonb_build_object('code','already_reported','reportId',stored.id,'targetType',stored.target_type,'targetId',stored.target_id,'createdAt',stored.created_at);
 end if;
 if not permitted then return jsonb_build_object('code','target_unavailable'); end if;
 insert into public.reports(id,reporter_id,target_type,target_id,reason)
 values(p_report_id,viewer,p_target_type,p_target_id,reason) on conflict(id) do nothing returning * into stored;
 if found then
  return jsonb_build_object('code','reported','reportId',stored.id,'targetType',stored.target_type,'targetId',stored.target_id,'createdAt',stored.created_at);
 end if;
 select * into stored from public.reports where id=p_report_id;
 if stored.reporter_id<>viewer or stored.target_type<>p_target_type or stored.target_id<>p_target_id or stored.reason<>reason then
  return jsonb_build_object('code','report_conflict');
 end if;
 return jsonb_build_object('code','already_reported','reportId',stored.id,'targetType',stored.target_type,'targetId',stored.target_id,'createdAt',stored.created_at);
end;$$;
-- Request history can exist without a conversation. Return no identity/profile fields.
create function public.request_has_deleted_pilot(p_request_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.flight_requests r join public.flights f on f.id=r.flight_id
  join public.memberships v on v.user_id=auth.uid() and v.status='active'
  join public.memberships other on other.user_id=case when f.owner_id=auth.uid() then r.requester_id else f.owner_id end
  where r.id=p_request_id and auth.uid() in(f.owner_id,r.requester_id) and other.deleted_at is not null)
$$;
-- History-only label: no arbitrary membership/profile enumeration or new history access.
create function public.conversation_has_deleted_pilot(p_conversation_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.conversations c join public.memberships v on v.user_id=auth.uid() and v.status='active'
  join public.memberships other on other.user_id=case when c.owner_id=auth.uid() then c.requester_id else c.owner_id end
  where c.id=p_conversation_id and auth.uid() in(c.owner_id,c.requester_id) and other.deleted_at is not null)
$$;
revoke all on all functions in schema deletion_private from public,anon,authenticated,service_role;
revoke all on function public.admin_account_deletion_preview(uuid),public.admin_begin_account_deletion(uuid,uuid,text,uuid),public.admin_prepare_account_deletion(uuid),public.admin_account_deletion_status(uuid),public.admin_finish_deletion_photos(uuid),public.admin_complete_account_deletion(uuid),public.request_has_deleted_pilot(uuid),public.conversation_has_deleted_pilot(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_account_deletion_preview(uuid),public.admin_begin_account_deletion(uuid,uuid,text,uuid),public.admin_prepare_account_deletion(uuid),public.admin_account_deletion_status(uuid),public.admin_finish_deletion_photos(uuid),public.admin_complete_account_deletion(uuid),public.request_has_deleted_pilot(uuid),public.conversation_has_deleted_pilot(uuid) to authenticated;
comment on schema deletion_private is 'Verified founder-managed deletion receipts and default-off provider-retention gate. No hosted execution permission. Auth uses irreversible provider soft deletion; UUID tombstones and shared history remain pseudonymous, not anonymous.';
commit;
