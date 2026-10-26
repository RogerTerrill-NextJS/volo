-- VOLO-215: retained moderation uses the existing cancellation/connection rules.
alter table public.flights add column moderated_at timestamptz;
alter table public.flights add constraint flights_hidden_closed check(moderated_at is null or (isfinite(moderated_at) and status<>'open'));
create table public.flight_moderation_audit (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid not null references public.memberships(user_id) on delete restrict,
 flight_id uuid not null unique references public.flights(id) on delete restrict,
 action text not null default 'flight_hidden' check(action='flight_hidden'),
 created_at timestamptz not null check(isfinite(created_at)),
 reason text not null check(char_length(reason) between 1 and 500 and reason !~ '^[[:space:]]*$')
);
alter table public.flight_moderation_audit enable row level security;
revoke all on public.flight_moderation_audit from public,anon,authenticated,service_role;
grant select on public.flight_moderation_audit to authenticated;
create policy flight_moderation_audit_read_admin on public.flight_moderation_audit for select to authenticated using (
 exists(select 1 from public.memberships where user_id=(select auth.uid()) and role='admin' and status='active')
);

create function public.admin_hide_flight(p_flight_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare viewer uuid:=(select auth.uid()); flight public.flights%rowtype; hidden_time timestamptz; reason text:=btrim(p_reason);
begin
 -- Reject unauthorized callers before acquiring a target lock; recheck current
 -- authority under lock below. JWT metadata never supplies administrative role.
 if not exists(select 1 from public.memberships where user_id=viewer and role='admin' and status='active') then
  raise exception 'Flight moderation unavailable' using errcode='42501';
 end if;
 if p_flight_id is null or reason is null or char_length(reason) not between 1 and 500 or reason ~ '^[[:space:]]*$' then
  raise exception 'Invalid flight moderation' using errcode='22023';
 end if;
 -- Match sends and request lifecycle: flight before request/conversation and
 -- membership locks. No membership-to-flight lock inversion is introduced.
 select * into flight from public.flights where id=p_flight_id for update;
 perform 1 from public.memberships where user_id=viewer and role='admin' and status='active' for share;
 if not found then raise exception 'Flight moderation unavailable' using errcode='42501'; end if;
 if flight.id is null then return jsonb_build_object('code','flight_unavailable'); end if;
 if flight.moderated_at is not null then
  return jsonb_build_object('code','already_hidden','flightId',flight.id,'moderatedAt',flight.moderated_at,'status',flight.status);
 end if;
 if flight.status='open' then
  perform public.cancel_flight(flight.id);
  flight.status:='cancelled';
 else
  -- Completed/cancelled post identity and lifecycle are retained. Terminal
  -- request states remain unchanged; any remaining live requests are closed.
  update public.flight_requests set status='cancelled' where flight_id=flight.id and status in ('pending','accepted');
 end if;
 hidden_time:=clock_timestamp();
 update public.flights set moderated_at=hidden_time where id=flight.id;
 insert into public.flight_moderation_audit(actor_id,flight_id,created_at,reason) values(viewer,flight.id,hidden_time,reason);
 return jsonb_build_object('code','hidden','flightId',flight.id,'moderatedAt',hidden_time,'status',flight.status);
end;$$;

create function public.admin_flight_overview(p_after_flight_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare viewer uuid:=(select auth.uid()); result jsonb;
begin
 perform 1 from public.memberships where user_id=viewer and role='admin' and status='active' for share;
 if not found then raise exception 'Flight moderation unavailable' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',r.id,'owner_id',r.owner_id,'departure_airport',r.departure_airport,'destination_airport',r.destination_airport,
  'departure_at',r.departure_at,'departure_timezone',r.departure_timezone,'departure_local_date',r.departure_local_date,
  'aircraft_description',r.aircraft_description,'pilot_places',r.pilot_places,'notes',r.notes,'visibility',r.visibility,
  'status',r.status,'created_at',r.created_at,'moderated_at',r.moderated_at,'moderation_reason',r.reason
 ) order by r.id),'[]'::jsonb) into result from (
  select f.*,a.reason from public.flights f left join public.flight_moderation_audit a on a.flight_id=f.id
  where p_after_flight_id is null or f.id>p_after_flight_id order by f.id limit 51
 ) r;
 return result;
end;$$;
revoke all on function public.admin_hide_flight(uuid,text),public.admin_flight_overview(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_hide_flight(uuid,text),public.admin_flight_overview(uuid) to authenticated;

-- Narrow ordinary member reads, including selected PRIVATE recipients. Retain
-- the actual owner's post record; request/message history has separate policies.
alter policy flights_read_visible on public.flights using (
 exists(select 1 from public.memberships where user_id=(select auth.uid()) and status='active')
 and (visibility='NETWORK' or flight_private.viewer_has_private_access(id))
 and (moderated_at is null or owner_id=(select auth.uid()))
);
comment on column public.flights.moderated_at is
 'Retained hidden post marker. Hidden records cannot be open; eligible discovery and new acceptance/sends use the existing closed lifecycle. Ordinary reads retain actual owner access only. No user unhide operation.';
comment on table public.flight_moderation_audit is
 'One immutable flight_hidden event per retained post, with authoritative actor/target/time/reason. Current active admins read; direct authenticated/service-role writes and RPC bypass are denied. No conversation contents or recipient lists.';
comment on function public.admin_hide_flight(uuid,text) is
 'Active membership admin only, independent of owner/profile/departure. Common flight lock, then rechecked admin share lock; uses existing cancel_flight for open posts and closes any remaining active requests for completed/cancelled posts. Existing triggers close conversations. Retains all post/request/recipient/message history and completed lifecycle. Hidden marker and immutable audit commit atomically; retries return original time/status without rewriting reason or adding events. No unhide or hard delete.';
comment on function public.admin_flight_overview(uuid) is
 'Explicit active-admin moderation read of up to 51 UUID-ordered posts, including PRIVATE/hidden posts. Bounded post and audit fields only; no recipient lists, Auth/email/contact data, introductory notes or private conversation contents. Does not widen ordinary member, request or message RLS.';
