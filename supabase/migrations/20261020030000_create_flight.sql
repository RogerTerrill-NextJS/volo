-- VOLO-176: the sole member creation boundary; direct table writes stay closed.
create function public.create_flight(
  p_departure_airport text,
  p_destination_airport text,
  p_departure_at timestamptz,
  p_departure_timezone text,
  p_aircraft_description text,
  p_pilot_places integer,
  p_notes text,
  p_visibility public.flight_visibility
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  viewer uuid := (select auth.uid());
  created_id uuid;
begin
  if viewer is null then
    raise exception 'Flight creation denied' using errcode = '42501';
  end if;
  -- Serialize eligibility with disable/profile changes in this fixed order.
  perform 1 from public.memberships
    where user_id = viewer and status = 'active' for share;
  if not found then
    raise exception 'Flight creation denied' using errcode = '42501';
  end if;
  perform 1 from public.profiles
    where user_id = viewer and pilot_designation = 'licensed' for share;
  if not found then
    raise exception 'Flight creation denied' using errcode = '42501';
  end if;
  if p_departure_at is null or not isfinite(p_departure_at)
    or p_departure_at <= clock_timestamp() then
    raise exception 'Choose a future departure' using errcode = '22023';
  end if;
  insert into public.flights (
    owner_id, departure_airport, destination_airport, departure_at,
    departure_timezone, aircraft_description, pilot_places, notes, visibility
  ) values (
    viewer, p_departure_airport, p_destination_airport, p_departure_at,
    p_departure_timezone, p_aircraft_description, p_pilot_places, nullif(p_notes, ''), p_visibility
  ) returning id into created_id;
  return created_id;
end;
$$;
revoke all on function public.create_flight(text,text,timestamptz,text,text,integer,text,public.flight_visibility)
  from public, anon, authenticated, service_role;
grant execute on function public.create_flight(text,text,timestamptz,text,text,integer,text,public.flight_visibility)
  to authenticated;
comment on function public.create_flight(text,text,timestamptz,text,text,integer,text,public.flight_visibility) is
  'Atomic active completed-profile creation; owner from auth.uid(), current database time, UUID-only return. PRIVATE starts owner-only; no direct table write grants or automatic retries.';
