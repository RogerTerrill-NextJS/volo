-- VOLO-179: narrow session writes; existing direct table grants/RLS stay closed.
create function flight_private.validate_recipient_ids(viewer uuid, recipients uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
declare target uuid;
begin
 if recipients is null or coalesce(array_ndims(recipients),1) <> 1
   or cardinality(recipients) = 0 or octet_length(recipients::text) > 16384
   or exists (select 1 from unnest(recipients) r where r is null or r = viewer)
   or (select count(distinct r) from unnest(recipients) r) <> cardinality(recipients) then
  raise exception 'Invalid private selection' using errcode = '22023';
 end if;
 for target in select r from unnest(recipients) r order by r loop
  perform 1 from public.memberships where user_id = target and status = 'active' for share;
  if not found then raise exception 'Invalid private selection' using errcode = '22023'; end if;
 end loop;
end;$$;
revoke all on function flight_private.validate_recipient_ids(uuid,uuid[]) from public,anon,authenticated,service_role;

create function public.create_private_flight(
 p_departure_airport text, p_destination_airport text, p_departure_at timestamptz,
 p_departure_timezone text, p_aircraft_description text, p_pilot_places integer,
 p_notes text, p_recipient_ids uuid[]
) returns uuid language plpgsql security definer set search_path = '' as $$
declare created_id uuid;
begin
 -- The existing boundary derives the owner, locks eligibility and checks time.
 created_id := public.create_flight(p_departure_airport,p_destination_airport,
  p_departure_at,p_departure_timezone,p_aircraft_description,p_pilot_places,p_notes,'PRIVATE');
 perform flight_private.validate_recipient_ids((select auth.uid()),p_recipient_ids);
 insert into public.flight_recipients(flight_id,user_id)
  select created_id,r from unnest(p_recipient_ids) r order by r;
 return created_id;
end;$$;
revoke all on function public.create_private_flight(text,text,timestamptz,text,text,integer,text,uuid[])
 from public,anon,authenticated,service_role;
grant execute on function public.create_private_flight(text,text,timestamptz,text,text,integer,text,uuid[]) to authenticated;

create function public.change_flight_recipient(p_flight_id uuid,p_recipient_id uuid,p_selected boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare viewer uuid := (select auth.uid()); flight_owner uuid; mode public.flight_visibility;
begin
 perform 1 from public.memberships where user_id=viewer and status='active' for share;
 if not found then raise exception 'Recipient change denied' using errcode='42501'; end if;
 select owner_id,visibility into flight_owner,mode from public.flights where id=p_flight_id for update;
 if not found or flight_owner <> viewer then
  raise exception 'Recipient change denied' using errcode='42501';
 end if;
 if mode <> 'PRIVATE' or p_recipient_id is null or p_recipient_id=viewer or p_selected is null then
  raise exception 'Invalid private selection' using errcode='22023';
 end if;
 if p_selected then
  perform flight_private.validate_recipient_ids(viewer,array[p_recipient_id]);
  insert into public.flight_recipients(flight_id,user_id) values(p_flight_id,p_recipient_id)
   on conflict(flight_id,user_id) do nothing;
 else
  -- No request/conversation relations exist today. Their owning migration must
  -- replace this fence with VOLO-172 cancellation/closure/history atomically.
  -- Never silently introduce a recipient-only delete once those features exist.
  if to_regclass('public.flight_requests') is not null or to_regclass('public.conversations') is not null then
   raise exception 'Recipient lifecycle unavailable' using errcode='55000';
  end if;
  delete from public.flight_recipients where flight_id=p_flight_id and user_id=p_recipient_id;
 end if;
 return p_flight_id;
end;$$;
revoke all on function public.change_flight_recipient(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.change_flight_recipient(uuid,uuid,boolean) to authenticated;
comment on function public.change_flight_recipient(uuid,uuid,boolean) is
 'Current active owner only; PRIVATE flight lock; add rechecks active target. Removal fails closed when request/conversation tables exist until atomic VOLO-172 cancellation/closure/history is integrated. Re-add never revives request/sending state.';
comment on function public.create_private_flight(text,text,timestamptz,text,text,integer,text,uuid[]) is
 'Atomic owner-derived PRIVATE creation plus nonempty validated selection; failure rolls back flight and all recipients. Existing owner-only create_flight remains compatible.';
