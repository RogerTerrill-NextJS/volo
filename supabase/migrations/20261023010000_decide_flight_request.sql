-- VOLO-193: atomic owner decisions. Direct member request-table writes stay closed.
create function public.decide_flight_request(p_flight_id uuid,p_request_id uuid,p_decision text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare viewer uuid := (select auth.uid()); flight public.flights%rowtype;
 request public.flight_requests%rowtype;
begin
 if viewer is null then raise exception 'Request decision denied' using errcode='42501'; end if;
 perform 1 from public.memberships where user_id=viewer and status='active' for share;
 if not found then raise exception 'Request decision denied' using errcode='42501'; end if;
 if p_flight_id is null or p_request_id is null or p_decision is null
  or p_decision not in ('accepted','declined') then
  raise exception 'Invalid request decision' using errcode='22023';
 end if;
 -- Same lock order as submission and recipient removal: flight before request.
 select * into flight from public.flights where id=p_flight_id for update;
 if not found or flight.owner_id<>viewer then
  raise exception 'Request decision denied' using errcode='42501';
 end if;
 select * into request from public.flight_requests
  where id=p_request_id and flight_id=flight.id for update;
 if not found then return jsonb_build_object('code','request_unavailable'); end if;
 -- Matching retries confirm history without updating notes or any timestamps.
 if request.status::text=p_decision then
  return jsonb_build_object('code','already_decided','requestId',request.id,'status',request.status);
 end if;
 if request.status<>'pending' then return jsonb_build_object('code','request_conflict'); end if;
 if p_decision='accepted' then
  if flight.status<>'open' or flight.departure_at<=clock_timestamp() or request.requester_id=viewer then
   return jsonb_build_object('code','request_ineligible');
  end if;
  perform 1 from public.memberships where user_id=request.requester_id and status='active' for share;
  if not found then return jsonb_build_object('code','request_ineligible'); end if;
  perform 1 from public.profiles where user_id=request.requester_id and pilot_designation='licensed' for share;
  if not found then return jsonb_build_object('code','request_ineligible'); end if;
  if flight.visibility='PRIVATE' and not exists (
   select 1 from public.flight_recipients where flight_id=flight.id and user_id=request.requester_id
  ) then return jsonb_build_object('code','request_ineligible'); end if;
  if (select count(*) from public.flight_requests where flight_id=flight.id and status='accepted')>=flight.pilot_places then
   return jsonb_build_object('code','capacity_full');
  end if;
 end if;
 -- Decline is terminal closure, including after departure/target disablement.
 -- The persistence trigger independently validates acceptance and owns timestamps.
 begin
  update public.flight_requests set status=p_decision::public.flight_request_status where id=request.id;
 exception when check_violation then
  -- In particular, departure can pass between our check and the trigger's clock.
  return jsonb_build_object('code','request_ineligible');
 end;
 return jsonb_build_object('code','decided','requestId',request.id,'status',p_decision);
end;$$;
revoke all on function public.decide_flight_request(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.decide_flight_request(uuid,uuid,text) to authenticated;
comment on function public.decide_flight_request(uuid,uuid,text) is
 'Active actual owner only, identity from auth.uid(). Flight lock before bound request lock. Pending accepts recheck active licensed requester, open/future flight, PRIVATE selection and capacity; pending decline permits terminal closure. Matching decisions are immutable no-op confirmations; opposing/terminal states conflict. Minimal UUID/status confirmations and fixed safe failure codes; direct member writes remain closed.';
