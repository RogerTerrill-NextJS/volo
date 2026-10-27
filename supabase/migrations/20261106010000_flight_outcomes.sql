-- VOLO-229: optional participant reports, never inferred from acceptance/messages.
begin;
create table public.flight_outcomes (
 request_id uuid not null references public.flight_requests(id) on delete restrict,
 respondent_id uuid not null references public.memberships(user_id) on delete restrict,
 flew_together boolean not null,
 revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(request_id,respondent_id)
);
alter table public.flight_outcomes enable row level security;
revoke all on public.flight_outcomes from public,anon,authenticated,service_role;
create index flight_outcomes_respondent on public.flight_outcomes(respondent_id,request_id);

-- The existing accepted pair, current audience and memberships remain authoritative.
create function flight_private.outcome_context(p_request_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('requestId',r.id,'flightId',f.id,
  'counterpartId',case when auth.uid()=f.owner_id then r.requester_id else f.owner_id end,
  'counterpartName',(select p.display_name from public.profiles p where p.user_id=case when auth.uid()=f.owner_id then r.requester_id else f.owner_id end and p.pilot_designation='licensed'),
  'departureAt',f.departure_at,'departureTimezone',f.departure_timezone,
  'departureAirport',f.departure_airport,'destinationAirport',f.destination_airport,
  'isOwner',auth.uid()=f.owner_id,'answer',o.flew_together,'revision',coalesce(o.revision,0),'updatedAt',o.updated_at)
 from public.flight_requests r join public.flights f on f.id=r.flight_id
 join public.memberships m1 on m1.user_id=f.owner_id and m1.status='active'
 join public.memberships m2 on m2.user_id=r.requester_id and m2.status='active'
 left join public.flight_outcomes o on o.request_id=r.id and o.respondent_id=auth.uid()
 where r.id=p_request_id and r.status='accepted' and f.status in('open','completed') and f.moderated_at is null
 and auth.uid() in(f.owner_id,r.requester_id) and f.owner_id<>r.requester_id
 and f.departure_local_date<(clock_timestamp() at time zone f.departure_timezone)::date
 and (f.visibility='NETWORK' or exists(select 1 from public.flight_recipients a where a.flight_id=f.id and a.user_id=r.requester_id))
$$;
revoke all on function flight_private.outcome_context(uuid) from public,anon,authenticated,service_role;
create function public.get_flight_outcome(p_request_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$select flight_private.outcome_context(p_request_id)$$;
create function public.list_flight_outcomes(p_after uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(item order by id),'[]'::jsonb) from (
  select r.id,flight_private.outcome_context(r.id) item from public.flight_requests r join public.flights f on f.id=r.flight_id
  where auth.uid() in(f.owner_id,r.requester_id) and (p_after is null or r.id>p_after)
   and flight_private.outcome_context(r.id) is not null order by r.id limit 21
 ) page
$$;
create function public.save_flight_outcome(p_request_id uuid,p_flew_together boolean,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare viewer uuid:=auth.uid(); flight public.flights; request public.flight_requests; response public.flight_outcomes; context jsonb;
begin
 if p_request_id is null or p_flew_together is null or p_expected_revision is null or p_expected_revision<0 then
  raise exception 'Invalid outcome' using errcode='22023'; end if;
 -- Match withdrawal/cancellation/moderation lock order. Recheck eligibility after waits.
 select f.* into flight from public.flights f join public.flight_requests r on r.flight_id=f.id where r.id=p_request_id for update of f;
 if not found then return jsonb_build_object('code','outcome_unavailable'); end if;
 select * into request from public.flight_requests where id=p_request_id for update;
 perform 1 from public.memberships where user_id in(flight.owner_id,request.requester_id) order by user_id for share;
 context:=flight_private.outcome_context(p_request_id);
 if context is null then return jsonb_build_object('code','outcome_unavailable'); end if;
 select * into response from public.flight_outcomes where request_id=p_request_id and respondent_id=viewer for update;
 if found then
  if response.flew_together=p_flew_together then return jsonb_build_object('code','saved','outcome',context); end if;
  if response.revision<>p_expected_revision then return jsonb_build_object('code','stale'); end if;
  update public.flight_outcomes set flew_together=p_flew_together,revision=revision+1,
   updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond') where request_id=p_request_id and respondent_id=viewer;
 else
  if p_expected_revision<>0 then return jsonb_build_object('code','stale'); end if;
  insert into public.flight_outcomes(request_id,respondent_id,flew_together) values(p_request_id,viewer,p_flew_together);
 end if;
 return jsonb_build_object('code','saved','outcome',flight_private.outcome_context(p_request_id));
end $$;
revoke all on function public.get_flight_outcome(uuid),public.list_flight_outcomes(uuid),public.save_flight_outcome(uuid,boolean,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_flight_outcome(uuid),public.list_flight_outcomes(uuid),public.save_flight_outcome(uuid,boolean,integer) to authenticated;
comment on table public.flight_outcomes is 'Minimal retained participant reports. One latest Yes/No per accepted request/respondent; corrections reuse the row. No text/contact snapshot. Later closure does not erase historical aggregate evidence; no raw client/admin/service grants.';
comment on function public.save_flight_outcome(uuid,boolean,integer) is 'Current actual participant only, no admin bypass. After local scheduled date; accepted open/completed unhidden flight, both active memberships and current PRIVATE selection. Locked revision-bound correction; identical retries do not change timestamps or counts. Returns only caller answer. No reminder, notification, flight-completion transition or other participant answer.';

create or replace function public.admin_mvp_metrics()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 -- Match the existing admin report boundary and fence role/status changes.
 perform 1 from public.memberships
  where user_id=(select auth.uid()) and role='admin' and status='active' for share;
 if not found then raise exception 'Metrics unavailable' using errcode='42501'; end if;
 -- One SELECT gives all aggregates one source snapshot. Existing source rows
 -- remain protected: no identity, text, route, recipient or message body is returned.
 with outcome_counts as (
  select request_id,count(*) filter(where flew_together) yes_count,count(*) filter(where not flew_together) no_count
  from public.flight_outcomes group by request_id
 ) select jsonb_build_object(
  'asOf',statement_timestamp(),
  'invitedPilots',(select count(distinct i.recipient_email_key) from public.invitations i where exists(
   select 1 from public.invitation_send_attempts a where a.invitation_id=i.id
    and coalesce(a.reconciled_outcome::text,a.outcome::text)='accepted')),
  'activatedPilots',(select count(distinct auth_user_id) from public.invitations where status='redeemed'),
  'activeMembers',(select count(*) from public.memberships where status='active'),
  'completedProfiles',(select count(*) from public.profiles),
  'activeProfiles',(select count(*) from public.profiles p join public.memberships m on m.user_id=p.user_id where m.status='active'),
  'flightPosts',(select count(*) from public.flights),
  'interestRequests',(select count(*) from public.flight_requests),
  'currentAcceptedRequests',(select count(*) from public.flight_requests where status='accepted'),
  'recordedAcceptedRequests',(select count(*) from public.flight_requests r where r.status='accepted'
   or exists(select 1 from public.notifications n where n.request_id=r.id and n.event_type='request_accepted')
   or exists(select 1 from public.conversations c where c.flight_request_id=r.id)),
  'messages',(select count(*) from public.messages),
  'messagingConversations',(select count(distinct conversation_id) from public.messages),
  'outcomes','participant_reported',
  'outcomeResponses',(select count(*) from public.flight_outcomes),
  'confirmedConnections',(select count(*) from outcome_counts where yes_count>0),
  'oneParticipantConfirmed',(select count(*) from outcome_counts where yes_count=1),
  'bothParticipantsConfirmed',(select count(*) from outcome_counts where yes_count=2),
  'conflictingConnections',(select count(*) from outcome_counts where yes_count=1 and no_count=1)
 ) into result;
 return result;
end;$$;

comment on function public.admin_mvp_metrics() is 'Current active admin aggregate snapshot from existing sources. Outcome responses count latest participant answers; distinct request IDs count connections once. Confirmed means at least one self-reported Yes, not verified flying; exactly-one includes conflicting Yes/No, also counted separately. Both means two Yes answers. Unanswered is not No. Corrections change gauges; historical responses survive later closure without disclosing respondent identities or answers.';
commit;
