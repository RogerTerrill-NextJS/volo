-- VOLO-199: one atomic lifecycle operation; no hard deletion or message engine.
create function public.cancel_flight(p_flight_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare viewer uuid := (select auth.uid()); actor_role public.member_role;
 flight public.flights%rowtype;
begin
 if viewer is null then raise exception 'Flight cancellation denied' using errcode='42501'; end if;
 -- Lock the authoritative membership, including role, through commit. Closure
 -- needs no profile/future-departure prerequisite and permits admin intervention
 -- when the owner is unavailable.
 select role into actor_role from public.memberships
  where user_id=viewer and status='active' for share;
 if not found then raise exception 'Flight cancellation denied' using errcode='42501'; end if;
 if p_flight_id is null then raise exception 'Invalid flight cancellation' using errcode='22023'; end if;
 -- Common protocol with acceptance, withdrawal, interest, edit and removal:
 -- flight before requests. A racing acceptance either precedes closure and is
 -- cancelled, or observes the closed request/flight and cannot accept.
 select * into flight from public.flights where id=p_flight_id for update;
 if not found or (flight.owner_id<>viewer and actor_role<>'admin') then
  raise exception 'Flight cancellation denied' using errcode='42501';
 end if;
 if flight.status='cancelled' then
  return jsonb_build_object('code','already_cancelled','flightId',flight.id,'status','cancelled');
 end if;
 if flight.status<>'open' then return jsonb_build_object('code','flight_conflict'); end if;
 -- Preserve identity, original notes, recipients and all terminal history.
 -- These two writes roll back together on any failure. No conversations exist;
 -- VOLO-81 must serialize sends on this same lock and reject closed state.
 update public.flight_requests set status='cancelled'
  where flight_id=flight.id and status in ('pending','accepted');
 update public.flights set status='cancelled' where id=flight.id;
 return jsonb_build_object('code','cancelled','flightId',flight.id,'status','cancelled');
end;$$;
revoke all on function public.cancel_flight(uuid) from public,anon,authenticated,service_role;
grant execute on function public.cancel_flight(uuid) to authenticated;
comment on function public.cancel_flight(uuid) is
 'Active actual owner or authoritative membership admin, identity from auth.uid(). Membership share lock then common flight lock before requests. Open flight cancellation atomically sets pending/accepted requests cancelled and flight cancelled, preserving identity/notes/audience/terminal history. No profile or future-departure prerequisite for closure; completed flight conflicts. Cancelled retry is immutable no-op. Fixed code and UUID/status confirmation only. No hard deletion. VOLO-81 sends must use this flight lock and reject closed flight/request state; no messaging tables queried here.';
