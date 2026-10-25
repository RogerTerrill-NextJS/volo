-- VOLO-213: ordinary-session admin operations, distinct from account deletion.
create table public.member_admin_audit (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references public.memberships(user_id) on delete restrict,
 action text not null default 'member_disabled' check(action='member_disabled'),
 target_id uuid not null references public.memberships(user_id) on delete restrict,
 created_at timestamptz not null,
 reason text not null check(char_length(reason) between 1 and 500 and reason !~ '^[[:space:]]*$'),
 check(actor_id<>target_id)
);
create index member_admin_audit_target_time on public.member_admin_audit(target_id,created_at,id);
alter table public.member_admin_audit enable row level security;
revoke all on public.member_admin_audit from public,anon,authenticated,service_role;
grant select on public.member_admin_audit to authenticated;
create policy member_admin_audit_read_admin on public.member_admin_audit for select to authenticated using (
 exists(select 1 from public.memberships m where m.user_id=(select auth.uid()) and m.role='admin' and m.status='active')
);

create function public.admin_member_overview(p_after_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare viewer uuid:=(select auth.uid()); result jsonb;
begin
 -- Keep current role/status locked through the statement snapshot.
 perform 1 from public.memberships where user_id=viewer and role='admin' and status='active' for share;
 if not found then raise exception 'Member administration unavailable' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'userId',r.user_id,'displayName',r.display_name,'role',r.role,'status',r.status,
  'createdAt',r.created_at,'disabledAt',r.disabled_at,'disabledReason',left(btrim(r.disabled_reason),500),
  'disabledReasonTruncated',coalesce(char_length(btrim(r.disabled_reason))>500,false)
 ) order by r.user_id),'[]'::jsonb) into result from (
  select m.user_id,p.display_name,m.role,m.status,m.created_at,m.disabled_at,m.disabled_reason
  from public.memberships m left join public.profiles p on p.user_id=m.user_id
  where p_after_user_id is null or m.user_id>p_after_user_id order by m.user_id limit 51
 ) r;
 return result;
end;$$;

create function public.admin_disable_member(p_target_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare viewer uuid:=(select auth.uid()); target public.memberships%rowtype; disabled_time timestamptz; reason text:=btrim(p_reason);
begin
 -- A consistent pair lock serializes retries and cross-admin disables. A waiting
 -- actor must still be an active admin after the winning transaction commits.
 perform 1 from public.memberships where user_id in(viewer,p_target_id) order by user_id for update;
 if not exists(select 1 from public.memberships where user_id=viewer and role='admin' and status='active') then
  raise exception 'Member administration unavailable' using errcode='42501';
 end if;
 if p_target_id is null or reason is null or char_length(reason) not between 1 and 500 or reason ~ '^[[:space:]]*$' then
  raise exception 'Invalid disable request' using errcode='22023';
 end if;
 if viewer=p_target_id then return jsonb_build_object('code','self_disable_not_allowed'); end if;
 select * into target from public.memberships where user_id=p_target_id;
 if not found then return jsonb_build_object('code','member_unavailable'); end if;
 if target.status='disabled' then return jsonb_build_object('code','already_disabled','userId',target.user_id,'disabledAt',target.disabled_at); end if;
 disabled_time:=clock_timestamp();
 update public.memberships set status='disabled',disabled_at=disabled_time,disabled_reason=reason where user_id=p_target_id;
 insert into public.member_admin_audit(actor_id,action,target_id,created_at,reason)
 values(viewer,'member_disabled',p_target_id,disabled_time,reason);
 return jsonb_build_object('code','disabled','userId',p_target_id,'disabledAt',disabled_time);
end;$$;
revoke all on function public.admin_member_overview(uuid),public.admin_disable_member(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_member_overview(uuid),public.admin_disable_member(uuid,text) to authenticated;
comment on table public.member_admin_audit is 'Atomic append-only member disable events. No account deletion, role promotion or reactivation grant.';
