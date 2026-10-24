-- VOLO-201: derive approval from the existing request; persist no new state.
create function public.get_flight_connection(p_request_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('requestId',r.id,'flightId',f.id,
  'ownerId',f.owner_id,'requesterId',r.requester_id)
 from public.flight_requests r
 join public.flights f on f.id=r.flight_id
 join public.memberships owner_member on owner_member.user_id=f.owner_id and owner_member.status='active'
 join public.memberships requester_member on requester_member.user_id=r.requester_id and requester_member.status='active'
 where r.id=p_request_id and r.status='accepted' and f.status='open'
  and r.requester_id<>f.owner_id
  and (select auth.uid()) in (f.owner_id,r.requester_id)
  and (f.visibility='NETWORK' or (f.visibility='PRIVATE' and exists (
   select 1 from public.flight_recipients a where a.flight_id=f.id and a.user_id=r.requester_id
  )))
$$;
revoke all on function public.get_flight_connection(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_flight_connection(uuid) to authenticated;
comment on function public.get_flight_connection(uuid) is
 'Read-only active connection projection from accepted flight_requests on open flights. Only the actual owner/requester pair with both memberships currently active; no admin bypass or profile prerequisite. PRIVATE requires current requester selection. Past departure alone does not revoke acceptance. Missing/ineligible/closed relationships return null; UUID pair/flight/request only, never notes or contact data. Retained request history keeps its existing separate policies. This snapshot is not a durable messaging grant; VOLO-81 must recheck and serialize sends with closure.';
