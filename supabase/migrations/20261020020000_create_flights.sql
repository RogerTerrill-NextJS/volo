-- VOLO-173: additive persistence; user-facing writes belong to guarded operations.
create type public.flight_visibility as enum ('NETWORK', 'PRIVATE');
create type public.flight_status as enum ('open', 'cancelled', 'completed');
revoke all on type public.flight_visibility, public.flight_status from public, anon;
grant usage on type public.flight_visibility, public.flight_status to authenticated, service_role;

create table public.flights (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.memberships (user_id) on delete restrict,
  departure_airport text not null,
  destination_airport text not null,
  departure_at timestamptz not null,
  departure_timezone text not null,
  departure_local_date date not null,
  aircraft_description text not null,
  pilot_places integer not null,
  notes text,
  visibility public.flight_visibility not null,
  status public.flight_status not null default 'open',
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint flights_departure_airport check (departure_airport ~ '^[A-Z0-9]{2,8}$'),
  constraint flights_destination_airport check (destination_airport ~ '^[A-Z0-9]{2,8}$'),
  constraint flights_departure_finite check (isfinite(departure_at)),
  constraint flights_aircraft_description check (
    char_length(aircraft_description) between 1 and 500
    and aircraft_description ~ '[^[:space:]]'
    and aircraft_description !~ '^[[:space:]]|[[:space:]]$'
  ),
  constraint flights_pilot_places check (pilot_places > 0),
  constraint flights_notes check (char_length(notes) <= 2000)
);

create table public.flight_recipients (
  flight_id uuid not null references public.flights (id) on delete restrict,
  user_id uuid not null references public.memberships (user_id) on delete restrict,
  added_at timestamptz not null default statement_timestamp(),
  primary key (flight_id, user_id)
);

create index flights_departure_order on public.flights (departure_at, id);
create index flights_owner_departure_order on public.flights (owner_id, departure_at, id);
create index flights_visibility_departure_order on public.flights (visibility, departure_at, id);
create index flight_recipients_user_flight on public.flight_recipients (user_id, flight_id);

create schema flight_private;
revoke all on schema flight_private from public, anon, authenticated, service_role;
grant usage on schema flight_private to authenticated;

-- The trigger derives rather than trusting the supplied local calendar date.
-- Local wall-clock ambiguity/gap validation belongs to the input conversion ticket.
create function flight_private.prepare_flight()
returns trigger
language plpgsql security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id then
      raise exception 'Flight owner is immutable' using errcode = '23514';
    end if;
    if new.visibility is distinct from old.visibility and new.visibility = 'NETWORK'
      and exists (select 1 from public.flight_recipients where flight_id = old.id) then
      raise exception 'Remove private audience through a guarded operation first' using errcode = '23514';
    end if;
    new.created_at := old.created_at;
  else
    new.created_at := statement_timestamp();
  end if;
  new.updated_at := statement_timestamp();
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

-- Serialize recipient eligibility with flight visibility edits. Future guarded
-- removal/request operations must also take this flight lock (VOLO-172).
create function flight_private.prepare_recipient()
returns trigger
language plpgsql security invoker
set search_path = ''
as $$
declare
  flight_owner uuid;
  flight_mode public.flight_visibility;
  member_state public.membership_status;
begin
  select owner_id, visibility into flight_owner, flight_mode
    from public.flights where id = new.flight_id for update;
  if not found then
    raise exception 'Recipient requires an existing flight' using errcode = '23503';
  end if;
  if flight_mode <> 'PRIVATE' or flight_owner = new.user_id then
    raise exception 'Only other pilots may be selected for a PRIVATE flight' using errcode = '23514';
  end if;
  select status into member_state from public.memberships
    where user_id = new.user_id for share;
  if member_state is distinct from 'active'::public.membership_status then
    raise exception 'Recipient must be an active member' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then new.added_at := old.added_at;
  else new.added_at := statement_timestamp(); end if;
  return new;
end;
$$;
revoke all on function flight_private.prepare_flight(), flight_private.prepare_recipient()
  from public, anon, authenticated, service_role;
create trigger flights_prepare before insert or update on public.flights
  for each row execute function flight_private.prepare_flight();
create trigger flight_recipients_prepare before insert or update on public.flight_recipients
  for each row execute function flight_private.prepare_recipient();

-- Definer predicates break the flight/recipient policy cycle. They derive the
-- viewer from auth.uid(), reveal only that viewer's relationship, and are not RPCs.
create function flight_private.viewer_owns_flight(target_flight uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.flights f
    join public.memberships m on m.user_id = (select auth.uid()) and m.status = 'active'
    where f.id = target_flight and f.owner_id = m.user_id
  );
$$;
create function flight_private.viewer_has_private_access(target_flight uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    join public.flights f on f.id = target_flight and f.visibility = 'PRIVATE'
    where m.user_id = (select auth.uid()) and m.status = 'active'
      and (f.owner_id = m.user_id or exists (
        select 1 from public.flight_recipients r
        where r.flight_id = f.id and r.user_id = m.user_id
      ))
  );
$$;
revoke all on function flight_private.viewer_owns_flight(uuid), flight_private.viewer_has_private_access(uuid)
  from public, anon, authenticated, service_role;
grant execute on function flight_private.viewer_owns_flight(uuid), flight_private.viewer_has_private_access(uuid)
  to authenticated;

alter table public.flights enable row level security;
alter table public.flight_recipients enable row level security;
revoke all on table public.flights, public.flight_recipients from public, anon, authenticated, service_role;
grant select on table public.flights, public.flight_recipients to authenticated;
-- Privileged persistence only; caller authorization belongs to guarded operations.
grant select, insert, update, delete on table public.flights, public.flight_recipients to service_role;

create policy flights_read_visible on public.flights for select to authenticated
using (
  exists (select 1 from public.memberships where user_id = (select auth.uid()) and status = 'active')
  and (visibility = 'NETWORK' or flight_private.viewer_has_private_access(id))
);
create policy flight_recipients_read_own_or_owner on public.flight_recipients for select to authenticated
using (
  exists (select 1 from public.memberships where user_id = (select auth.uid()) and status = 'active')
  and (user_id = (select auth.uid()) or flight_private.viewer_owns_flight(flight_id))
);

comment on table public.flights is
  'Flight opportunities. Active-member NETWORK/PRIVATE reads; member writes await guarded operations. Capacity excludes owner and remaining places are derived from accepted requests.';
comment on column public.flights.departure_timezone is
  'Named regional IANA zone or UTC; reject abbreviations, arbitrary offsets and fixed-offset Etc aliases. Not viewer timezone.';
comment on column public.flights.departure_local_date is
  'Database-derived calendar date of departure_at in departure_timezone; input is always overwritten.';
comment on column public.flights.status is
  'Lifecycle state; completed does not establish that participants flew together.';
comment on table public.flight_recipients is
  'PRIVATE audience, not request or history ownership. Future removal must atomically cancel requests and close sending under the VOLO-172 contract.';
-- No public write RPC, request/conversation tables, Realtime publication or cascading history deletion.
