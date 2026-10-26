-- VOLO-217: immutable manual intake, separate from moderation actions/blocking.
create table public.reports (
 id uuid primary key,
 reporter_id uuid not null references public.memberships(user_id) on delete restrict,
 target_type text not null check(target_type in ('pilot','flight','message')),
 target_id uuid not null,
 reason text not null check(char_length(reason) between 1 and 2000 and reason !~ '^[[:space:]]*$'),
 created_at timestamptz not null default clock_timestamp() check(isfinite(created_at))
);
create index reports_reporter_order on public.reports(reporter_id,id);
alter table public.reports enable row level security;
revoke all on public.reports from public,anon,authenticated,service_role;
grant select on public.reports to authenticated;
create policy reports_read_reporter_or_admin on public.reports for select to authenticated using (
 exists(select 1 from public.memberships m where m.user_id=(select auth.uid()) and m.status='active'
  and (reporter_id=m.user_id or m.role='admin'))
);

create function public.submit_report(p_report_id uuid,p_target_type text,p_target_id uuid,p_reason text)
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
revoke all on function public.submit_report(uuid,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.submit_report(uuid,text,uuid,text) to authenticated;
comment on table public.reports is
 'Immutable manual beta intake. Current active reporter or active admin reads only. Reference plus reporter-written reason; no copied message body, target snapshot, handling engine or personal block effects. Target reference grants no post/conversation permission. Retention is explicit: reporter FK restricts deletion; target UUID reference does not cascade history.';
comment on function public.submit_report(uuid,text,uuid,text) is
 'Ordinary active session only; reporter/time are server-owned. New reports require active licensed pilot visibility, ordinary NETWORK/PRIVATE/hidden-owner flight visibility, or actual retained message participation. Admins have no target bypass. Exact report UUID/payload retry returns original receipt even after target access loss; other payloads/reporters get fixed conflict. Concurrent exact retries insert once. No automatic member/flight/message/request mutation, private-message copy, privileged RPC bypass or case-management workflow.';
