-- VOLO-197: founder-approved cancellation/repost rule and capacity invariants.
create or replace function flight_private.prepare_flight()
returns trigger
language plpgsql security invoker
set search_path = ''
as $$
declare accepted_count bigint;
begin
  if tg_op = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id then
      raise exception 'Flight owner is immutable' using errcode = '23514';
    end if;
    if new.visibility is distinct from old.visibility and new.visibility = 'NETWORK'
      and exists (select 1 from public.flight_recipients where flight_id = old.id) then
      raise exception 'Remove private audience through a guarded operation first' using errcode = '23514';
    end if;
    select count(*) into accepted_count from public.flight_requests where flight_id=old.id and status='accepted';
    if new.pilot_places < accepted_count then
      raise exception 'Capacity cannot be below accepted participants' using errcode='23514';
    end if;
    if accepted_count > 0 and (
      new.departure_airport is distinct from old.departure_airport or new.destination_airport is distinct from old.destination_airport
      or new.departure_at is distinct from old.departure_at or new.departure_timezone is distinct from old.departure_timezone
      or new.aircraft_description is distinct from old.aircraft_description
    ) then
      raise exception 'Cancel and repost material changes with accepted participants' using errcode='23514';
    end if;
    new.created_at := old.created_at;
  else
    new.created_at := statement_timestamp();
  end if;
  -- A revision must advance even in one transaction or after a lock wait.
  new.updated_at := case when tg_op='UPDATE' then greatest(clock_timestamp(),old.updated_at+interval '1 microsecond') else statement_timestamp() end;
  if new.departure_timezone is not null and not (
    (new.departure_timezone = 'UTC' or (
      strpos(new.departure_timezone, '/') > 0
      and new.departure_timezone !~ '^(Etc|posix|right)/'
    )) and exists (
      select 1 from pg_catalog.pg_timezone_names where name = new.departure_timezone
    )
  ) then
    raise exception 'Use a named IANA departure timezone or UTC' using errcode = '23514';
  end if;
  new.departure_local_date := (new.departure_at at time zone new.departure_timezone)::date;
  return new;
end;
$$;

create function public.edit_flight(
 p_flight_id uuid,p_expected_updated_at timestamptz,
 p_departure_airport text,p_destination_airport text,p_departure_at timestamptz,
 p_departure_timezone text,p_aircraft_description text,p_pilot_places integer,p_notes text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare viewer uuid := (select auth.uid()); flight public.flights%rowtype;
 accepted_count bigint; revised_at timestamptz; note text := nullif(p_notes,'');
begin
 if viewer is null then raise exception 'Flight edit denied' using errcode='42501'; end if;
 perform 1 from public.memberships where user_id=viewer and status='active' for share;
 if not found then raise exception 'Flight edit denied' using errcode='42501'; end if;
 perform 1 from public.profiles where user_id=viewer and pilot_designation='licensed' for share;
 if not found then raise exception 'Flight edit denied' using errcode='42501'; end if;
 if p_flight_id is null or p_expected_updated_at is null or not isfinite(p_expected_updated_at) then
  raise exception 'Invalid flight edit' using errcode='22023';
 end if;
 -- Serialize with acceptance, withdrawal, submission and recipient removal.
 select * into flight from public.flights where id=p_flight_id for update;
 if not found or flight.owner_id<>viewer then raise exception 'Flight edit denied' using errcode='42501'; end if;
 if flight.status<>'open' or flight.departure_at<=clock_timestamp() then
  return jsonb_build_object('code','flight_unavailable');
 end if;
 if p_departure_at is null or not isfinite(p_departure_at) or p_departure_at<=clock_timestamp()
  or p_departure_airport is null or p_destination_airport is null or p_departure_timezone is null
  or p_aircraft_description is null or p_pilot_places is null or p_pilot_places<1 then
  raise exception 'Invalid flight edit' using errcode='22023';
 end if;
 -- An identical retry may confirm a committed update with its original token.
 -- It must not write timestamps or return another participant's information.
 if row(flight.departure_airport,flight.destination_airport,flight.departure_at,flight.departure_timezone,flight.aircraft_description,flight.pilot_places,flight.notes)
  is not distinct from row(p_departure_airport,p_destination_airport,p_departure_at,p_departure_timezone,p_aircraft_description,p_pilot_places,note) then
  return jsonb_build_object('code','already_updated','flightId',flight.id,'updatedAt',flight.updated_at);
 end if;
 if flight.updated_at<>p_expected_updated_at then return jsonb_build_object('code','flight_conflict'); end if;
 select count(*) into accepted_count from public.flight_requests where flight_id=flight.id and status='accepted';
 if p_pilot_places<accepted_count then return jsonb_build_object('code','capacity_conflict'); end if;
 if accepted_count>0 and (
  flight.departure_airport is distinct from p_departure_airport or flight.destination_airport is distinct from p_destination_airport
  or flight.departure_at is distinct from p_departure_at or flight.departure_timezone is distinct from p_departure_timezone
  or flight.aircraft_description is distinct from p_aircraft_description
 ) then return jsonb_build_object('code','repost_required'); end if;
 begin
  update public.flights set departure_airport=p_departure_airport,destination_airport=p_destination_airport,
   departure_at=p_departure_at,departure_timezone=p_departure_timezone,aircraft_description=p_aircraft_description,
   pilot_places=p_pilot_places,notes=note where id=flight.id returning updated_at into revised_at;
 exception when check_violation or not_null_violation then
  raise exception 'Invalid flight edit' using errcode='22023';
 end;
 return jsonb_build_object('code','updated','flightId',flight.id,'updatedAt',revised_at);
end;$$;
revoke all on function public.edit_flight(uuid,timestamptz,text,text,timestamptz,text,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.edit_flight(uuid,timestamptz,text,text,timestamptz,text,text,integer,text) to authenticated;
comment on function public.edit_flight(uuid,timestamptz,text,text,timestamptz,text,text,integer,text) is
 'Current active licensed actual owner; no admin bypass. Open/upcoming only. Shared flight lock rechecks expected revision, accepted capacity and material-change policy. Airports/instant/timezone/aircraft changes with accepted pilots require cancellation/repost; notes and capacity may change subject to accepted-count floor. Identical retries confirm without writes. Identity/creation/visibility/status/audience are not editable. Fixed result codes and UUID/revision-only confirmations.';
comment on column public.flights.updated_at is
 'Server-owned edit revision. Advances monotonically on UPDATE, including within one transaction and after lock waits. Owner edit uses expected revision to reject stale differing payloads; identical retry is no-op.';

