-- VOLO-189: narrow identity-derived submission; direct member table writes stay closed.
create function public.submit_flight_interest(p_flight_id uuid,p_introductory_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare viewer uuid := (select auth.uid()); flight public.flights%rowtype;
 existing public.flight_requests%rowtype; request_id uuid;
begin
 if viewer is null then raise exception 'Interest submission denied' using errcode='42501'; end if;
 perform 1 from public.memberships where user_id=viewer and status='active' for share;
 if not found then raise exception 'Interest submission denied' using errcode='42501'; end if;
 perform 1 from public.profiles where user_id=viewer and pilot_designation='licensed' for share;
 if not found then raise exception 'Interest submission denied' using errcode='42501'; end if;
 if p_flight_id is null or char_length(p_introductory_note)>500 then
  raise exception 'Invalid interest input' using errcode='22023';
 end if;
 -- Common lifecycle lock BEFORE request-row reads/writes. Removal, acceptance,
 -- creation and resubmission serialize here; never trust an earlier UI read.
 select * into flight from public.flights where id=p_flight_id for update;
 if not found then return jsonb_build_object('code','flight_unavailable'); end if;
 if flight.owner_id=viewer or flight.status<>'open' or flight.departure_at<=clock_timestamp()
  or (flight.visibility='PRIVATE' and not exists (
   select 1 from public.flight_recipients where flight_id=flight.id and user_id=viewer
  )) then return jsonb_build_object('code','flight_unavailable'); end if;
 perform 1 from public.memberships where user_id=flight.owner_id and status='active' for share;
 if not found then return jsonb_build_object('code','flight_unavailable'); end if;
 select * into existing from public.flight_requests where flight_id=flight.id and requester_id=viewer for update;
 if found then
  if existing.status in ('pending','accepted') then
   return jsonb_build_object('code','already_requested','requestId',existing.id,'status',existing.status);
  end if;
  if existing.status in ('declined','cancelled') then return jsonb_build_object('code','request_closed'); end if;
 end if;
 -- Approved MVP rule: no new/resubmitted interest when all joining places are
 -- accepted. Existing confirmed requests above are safe no-op reads.
 if (select count(*) from public.flight_requests where flight_id=flight.id and status='accepted')>=flight.pilot_places then
  return jsonb_build_object('code','flight_unavailable');
 end if;
 if existing.id is not null then
  update public.flight_requests set status='pending',introductory_note=nullif(p_introductory_note,'')
   where id=existing.id returning id into request_id;
 else
  insert into public.flight_requests(flight_id,requester_id,introductory_note)
   values(flight.id,viewer,nullif(p_introductory_note,'')) returning id into request_id;
 end if;
 return jsonb_build_object('code','submitted','requestId',request_id,'status','pending');
end;$$;
revoke all on function public.submit_flight_interest(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.submit_flight_interest(uuid,text) to authenticated;
comment on function public.submit_flight_interest(uuid,text) is
 'Active completed-profile identity from auth.uid(). Flight lock rechecks owner, upcoming/open, PRIVATE selection and remaining capacity. Pending/accepted duplicate is no-op; withdrawn reuses record; declined/cancelled stay terminal. UUID/state-only confirmation; missing/ineligible/full flight share safe outcome.';
