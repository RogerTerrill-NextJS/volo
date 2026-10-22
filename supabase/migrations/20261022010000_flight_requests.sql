-- VOLO-188: persistence and legal transitions. Member mutation RPCs follow in
-- VOLO-64/66/67; no direct client writes or blanket server-client bypass.
create type public.flight_request_status as enum ('pending','accepted','declined','withdrawn','cancelled');
revoke all on type public.flight_request_status from public, anon;
grant usage on type public.flight_request_status to authenticated, service_role;

create table public.flight_requests (
 id uuid primary key default gen_random_uuid(),
 flight_id uuid not null references public.flights(id) on delete restrict,
 requester_id uuid not null references public.memberships(user_id) on delete restrict,
 introductory_note text,
 status public.flight_request_status not null default 'pending',
 created_at timestamptz not null default statement_timestamp(),
 updated_at timestamptz not null default statement_timestamp(),
 status_changed_at timestamptz not null default statement_timestamp(),
 constraint flight_requests_flight_requester unique (flight_id,requester_id),
 constraint flight_requests_note check (char_length(introductory_note) <= 500)
);
create index flight_requests_requester_order on public.flight_requests(requester_id,created_at,id);
create index flight_requests_accepted on public.flight_requests(flight_id) where status='accepted';

create function flight_private.prepare_request()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare flight public.flights%rowtype;
begin
 -- Guarded runtime operations must acquire this same flight lock BEFORE updating
 -- a request row. INSERT also locks/rechecks here, including privileged imports.
 if tg_op='UPDATE' then
  if new.id is distinct from old.id or new.flight_id is distinct from old.flight_id
    or new.requester_id is distinct from old.requester_id then
   raise exception 'Request identity is immutable' using errcode='23514';
  end if;
  if new.status is distinct from old.status and not (
   (old.status='pending' and new.status in ('accepted','declined','withdrawn','cancelled'))
   or (old.status='accepted' and new.status='cancelled')
   or (old.status='withdrawn' and new.status='pending')
  ) then
   raise exception 'Illegal request transition' using errcode='23514';
  end if;
  if new.introductory_note is distinct from old.introductory_note
    and not (old.status='withdrawn' and new.status='pending') then
   raise exception 'Request note may change only on resubmission' using errcode='23514';
  end if;
  new.created_at := old.created_at;
  if new.status is distinct from old.status then new.status_changed_at := statement_timestamp();
  else new.status_changed_at := old.status_changed_at; end if;
 else
  if new.status is distinct from 'pending'::public.flight_request_status then
   raise exception 'Requests must start pending' using errcode='23514';
  end if;
  new.created_at := statement_timestamp();
  new.status_changed_at := statement_timestamp();
 end if;
 new.updated_at := statement_timestamp();
 select * into flight from public.flights where id=new.flight_id for update;
 if not found then raise exception 'Request requires an existing flight' using errcode='23503'; end if;
 if new.requester_id=flight.owner_id then
  raise exception 'Cannot request own flight' using errcode='23514';
 end if;
 -- Revalidate new interest/resubmission and acceptance. Terminal closure must
 -- remain possible after departure, disabling or removal of PRIVATE eligibility.
 if tg_op='INSERT' or (new.status is distinct from old.status and new.status in ('pending','accepted')) then
  if flight.status <> 'open' or flight.departure_at <= clock_timestamp() then
   raise exception 'Flight unavailable for request' using errcode='23514';
  end if;
  perform 1 from public.memberships where user_id=flight.owner_id and status='active' for share;
  if not found then raise exception 'Flight owner unavailable' using errcode='23514'; end if;
  perform 1 from public.memberships where user_id=new.requester_id and status='active' for share;
  if not found then raise exception 'Requester unavailable' using errcode='23514'; end if;
  perform 1 from public.profiles where user_id=new.requester_id and pilot_designation='licensed' for share;
  if not found then raise exception 'Complete requester profile required' using errcode='23514'; end if;
  if flight.visibility='PRIVATE' and not exists (
   select 1 from public.flight_recipients where flight_id=flight.id and user_id=new.requester_id
  ) then raise exception 'Private request denied' using errcode='23514'; end if;
  if new.status='accepted' and (select count(*) from public.flight_requests
    where flight_id=flight.id and status='accepted' and id<>new.id) >= flight.pilot_places then
   raise exception 'No joining places available' using errcode='23514';
  end if;
 end if;
 return new;
end;$$;
revoke all on function flight_private.prepare_request() from public,anon,authenticated,service_role;
create trigger flight_requests_prepare before insert or update on public.flight_requests
 for each row execute function flight_private.prepare_request();

alter table public.flight_requests enable row level security;
revoke all on table public.flight_requests from public,anon,authenticated,service_role;
grant select on table public.flight_requests to authenticated;
grant select,insert,update,delete on table public.flight_requests to service_role;
create policy flight_requests_read_participant on public.flight_requests for select to authenticated
using (
 exists (select 1 from public.memberships where user_id=(select auth.uid()) and status='active')
 and (requester_id=(select auth.uid()) or flight_private.viewer_owns_flight(flight_id))
);

-- Upgrade the VOLO-179 fence now that requests exist. Conversation introduction
-- must replace the remaining fence with actual atomic sending closure first.
create or replace function public.change_flight_recipient(p_flight_id uuid,p_recipient_id uuid,p_selected boolean)
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
  if to_regclass('public.conversations') is not null then
   raise exception 'Recipient lifecycle unavailable' using errcode='55000';
  end if;
  update public.flight_requests set status='cancelled'
   where flight_id=p_flight_id and requester_id=p_recipient_id and status in ('pending','accepted');
  delete from public.flight_recipients where flight_id=p_flight_id and user_id=p_recipient_id;
 end if;
 return p_flight_id;
end;$$;
comment on function public.change_flight_recipient(uuid,uuid,boolean) is
 'Active PRIVATE owner only. Under flight lock, removal cancels pending/accepted request and removes selection atomically; retains participant history. Conversation introduction must integrate sending closure before replacing the remaining fence. Re-add never revives requests.';
comment on table public.flight_requests is
 'One retained interest record per flight/requester. Active owner/requester reads independent of current PRIVATE selection. Member writes closed until guarded lifecycle operations.';
comment on column public.flight_requests.status is
 'Initially pending. Pending -> accepted/declined/withdrawn/cancelled; accepted -> cancelled; withdrawn -> pending with fresh eligibility. Declined/cancelled terminal. Accepted withdrawal is not yet authorized.';
comment on column public.flight_requests.introductory_note is
 'Optional introductory note, up to 500 characters. May be replaced only with withdrawn-to-pending resubmission.';
