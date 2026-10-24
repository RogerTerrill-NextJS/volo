-- VOLO-204: approved accepted-request-only, one-to-one conversation persistence.
-- Flight linkage is derived from the immutable request; participants are not editable.
create table public.conversations (
 id uuid primary key default gen_random_uuid(),
 flight_request_id uuid not null unique references public.flight_requests(id) on delete restrict,
 owner_id uuid not null references public.memberships(user_id) on delete restrict,
 requester_id uuid not null references public.memberships(user_id) on delete restrict,
 created_at timestamptz not null default statement_timestamp(),
 closed_at timestamptz,
 constraint conversations_distinct_pair check (owner_id<>requester_id),
 constraint conversations_closure_time check (closed_at is null or closed_at>=created_at)
);
create index conversations_owner_order on public.conversations(owner_id,created_at,id);
create index conversations_requester_order on public.conversations(requester_id,created_at,id);
alter table public.conversations enable row level security;
revoke all on public.conversations from public,anon,authenticated,service_role;
grant select on public.conversations to authenticated;
grant select,insert,update on public.conversations to service_role;
create policy conversations_read_participant on public.conversations for select to authenticated using (
 (owner_id=(select auth.uid()) or requester_id=(select auth.uid()))
 and exists(select 1 from public.memberships where user_id=(select auth.uid()) and status='active')
);

create function flight_private.prepare_conversation()
returns trigger language plpgsql security invoker set search_path='' as $$
declare request public.flight_requests%rowtype; flight public.flights%rowtype;
begin
 if tg_op='UPDATE' and (new.id is distinct from old.id or new.flight_request_id is distinct from old.flight_request_id
  or new.owner_id is distinct from old.owner_id or new.requester_id is distinct from old.requester_id) then
  raise exception 'Conversation identity is immutable' using errcode='23514';
 end if;
 -- Same protocol as request lifecycle operations: flight, request, conversation.
 select f.* into flight from public.flights f where f.id=(select r.flight_id from public.flight_requests r where r.id=new.flight_request_id) for update;
 if not found then raise exception 'Conversation request unavailable' using errcode='23503'; end if;
 select * into request from public.flight_requests where id=new.flight_request_id for update;
 if new.owner_id is distinct from flight.owner_id or new.requester_id is distinct from request.requester_id then
  raise exception 'Conversation pair must match request' using errcode='23514';
 end if;
 if tg_op='INSERT' or new.closed_at is null then
  if request.status<>'accepted' or flight.status<>'open' or (flight.visibility='PRIVATE' and not exists(
   select 1 from public.flight_recipients where flight_id=flight.id and user_id=request.requester_id)) then
   raise exception 'Conversation requires active acceptance' using errcode='23514';
  end if;
  perform 1 from public.memberships where user_id=flight.owner_id and status='active' for share;
  if not found then raise exception 'Conversation owner unavailable' using errcode='23514'; end if;
  perform 1 from public.memberships where user_id=request.requester_id and status='active' for share;
  if not found then raise exception 'Conversation requester unavailable' using errcode='23514'; end if;
 end if;
 if tg_op='INSERT' then new.created_at:=statement_timestamp();new.closed_at:=null;
 else
  new.created_at:=old.created_at;
  if new.closed_at is not null then new.closed_at:=coalesce(old.closed_at,greatest(clock_timestamp(),old.created_at)); end if;
 end if;
 return new;
end;$$;
revoke all on function flight_private.prepare_conversation() from public,anon,authenticated,service_role;
create trigger conversations_prepare before insert or update on public.conversations for each row execute function flight_private.prepare_conversation();

create function public.get_or_create_flight_conversation(p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare viewer uuid:=(select auth.uid()); request public.flight_requests%rowtype; flight public.flights%rowtype; conversation uuid;
begin
 if viewer is null then raise exception 'Conversation unavailable' using errcode='42501'; end if;
 if p_request_id is null then raise exception 'Invalid conversation request' using errcode='22023'; end if;
 select f.* into flight from public.flights f where f.id=(select r.flight_id from public.flight_requests r where r.id=p_request_id) for update;
 if not found then raise exception 'Conversation unavailable' using errcode='42501'; end if;
 select * into request from public.flight_requests where id=p_request_id for update;
 -- Lock both authoritative memberships through commit, including when returning
 -- an existing ID. JWT metadata, profile completeness and departure time grant nothing.
 perform 1 from public.memberships where user_id=flight.owner_id and status='active' for share;
 if not found then raise exception 'Conversation unavailable' using errcode='42501'; end if;
 perform 1 from public.memberships where user_id=request.requester_id and status='active' for share;
 if not found or public.get_flight_connection(p_request_id) is null then
  raise exception 'Conversation unavailable' using errcode='42501';
 end if;
 insert into public.conversations(flight_request_id,owner_id,requester_id)
 values(request.id,flight.owner_id,request.requester_id)
 on conflict(flight_request_id) do update set closed_at=null where public.conversations.closed_at is not null
 returning id into conversation;
 if conversation is null then select id into conversation from public.conversations where flight_request_id=request.id; end if;
 return conversation;
end;$$;
revoke all on function public.get_or_create_flight_conversation(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_or_create_flight_conversation(uuid) to authenticated;

-- Close retained threads in the same transaction that closes their source.
-- No message writes exist yet. VOLO-81 must acquire the common flight lock and
-- recheck live acceptance, membership, PRIVATE selection and closed_at for sends.
create function flight_private.close_request_conversation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status<>'accepted' then
  update public.conversations set closed_at=coalesce(closed_at,statement_timestamp()) where flight_request_id=new.id and closed_at is null;
 end if;
 return new;
end;$$;
create function flight_private.close_flight_conversations()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status<>'open' then
  update public.conversations c set closed_at=coalesce(c.closed_at,statement_timestamp())
   where c.flight_request_id in (select r.id from public.flight_requests r where r.flight_id=new.id) and c.closed_at is null;
 end if;
 return new;
end;$$;
revoke all on function flight_private.close_request_conversation() from public,anon,authenticated,service_role;
revoke all on function flight_private.close_flight_conversations() from public,anon,authenticated,service_role;
create trigger requests_close_conversation after update of status on public.flight_requests for each row execute function flight_private.close_request_conversation();
create trigger flights_close_conversations after update of status on public.flights for each row execute function flight_private.close_flight_conversations();

-- Replace only the temporary fences; retain existing request/recipient checks.
create or replace function flight_private.prepare_request()
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
   or (old.status='accepted' and new.status in ('withdrawn','cancelled'))
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
  update public.flight_requests set status='cancelled'
   where flight_id=p_flight_id and requester_id=p_recipient_id and status in ('pending','accepted');
  delete from public.flight_recipients where flight_id=p_flight_id and user_id=p_recipient_id;
 end if;
 return p_flight_id;
end;$$;
comment on table public.conversations is
 'Accepted flight requests only. One retained one-to-one thread per request; immutable owner/requester derived under flight lock. Active participants read history even after closure or PRIVATE removal, without flight visibility or admin bypass. No direct member writes or cascading history deletion.';
comment on function public.get_or_create_flight_conversation(uuid) is
 'Session-only idempotent create/open. Derives pair from request and serializes with lifecycle on flight then request. Current accepted/open connection, both active memberships and current PRIVATE selection required; no profile/departure prerequisite. Fresh acceptance permits explicit reopening of same history after withdrawal/resubmission. Never a durable send grant; VOLO-81 must recheck under same flight lock.';
comment on column public.conversations.closed_at is
 'Server-managed closure marker, atomically set by request/flight lifecycle. Re-add or pending resubmission never clears it; guarded explicit open after fresh acceptance may clear it. Active membership and live connection checks remain mandatory for future sends.';
comment on function public.change_flight_recipient(uuid,uuid,boolean) is
 'Active PRIVATE owner under common flight lock; removal cancels pending/accepted requests and closes any existing conversation atomically, then removes selection. Retains participant history; re-add does not revive requests or conversations.';
comment on function public.withdraw_flight_request(uuid,uuid) is
 'Active actual requester only, common flight lock before bound request. Pending/accepted withdrawal releases derived capacity and atomically closes existing conversation through persistence trigger, retaining history. No profile/future departure/PRIVATE eligibility prerequisite for closure. Eligible same-record resubmission returns pending; fresh acceptance required.';
comment on column public.flight_requests.status is
 'Pending -> accepted/declined/withdrawn/cancelled; accepted -> withdrawn/cancelled; withdrawn -> pending with fresh eligibility. Declined/cancelled terminal. Leaving accepted closes retained conversation atomically; resubmission never reopens it.';
