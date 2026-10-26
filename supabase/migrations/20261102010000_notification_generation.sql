-- VOLO-220: notifications commit with their owning operations. No public writer or backfill.
-- VOLO-189: narrow identity-derived submission; direct member table writes stay closed.
create or replace function public.submit_flight_interest(p_flight_id uuid,p_introductory_note text default null)
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
 -- Source and recipient are validated by private notification persistence.
 insert into public.notifications(event_type,request_id) values('request_received',request_id)
  on conflict(recipient_id,event_key) do nothing;
 return jsonb_build_object('code','submitted','requestId',request_id,'status','pending');
end;$$;
revoke all on function public.submit_flight_interest(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.submit_flight_interest(uuid,text) to authenticated;
comment on function public.submit_flight_interest(uuid,text) is
 'Active completed-profile identity from auth.uid(). Flight lock rechecks owner, upcoming/open, PRIVATE selection and remaining capacity. Pending/accepted duplicate is no-op; withdrawn reuses record; declined/cancelled stay terminal. UUID/state-only confirmation; missing/ineligible/full flight share safe outcome.';

-- VOLO-193: atomic owner decisions. Direct member request-table writes stay closed.
create or replace function public.decide_flight_request(p_flight_id uuid,p_request_id uuid,p_decision text)
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
 -- Keep notification failures outside the source eligibility exception handler:
 -- any persistence failure must roll back the acceptance, not confirm it.
 if p_decision='accepted' then
  insert into public.notifications(event_type,request_id) values('request_accepted',request.id)
   on conflict(recipient_id,event_key) do nothing;
 end if;
 return jsonb_build_object('code','decided','requestId',request.id,'status',p_decision);
end;$$;
revoke all on function public.decide_flight_request(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.decide_flight_request(uuid,uuid,text) to authenticated;
comment on function public.decide_flight_request(uuid,uuid,text) is
 'Active actual owner only, identity from auth.uid(). Flight lock before bound request lock. Pending accepts recheck active licensed requester, open/future flight, PRIVATE selection and capacity; pending decline permits terminal closure. Matching decisions are immutable no-op confirmations; opposing/terminal states conflict. Minimal UUID/status confirmations and fixed safe failure codes; direct member writes remain closed.';

-- VOLO-206: guarded session-only sends; direct message mutations remain closed.
create or replace function public.send_conversation_message(p_conversation_id uuid,p_message_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare viewer uuid:=(select auth.uid()); thread public.conversations%rowtype;
 source_flight uuid; stored public.messages%rowtype;
begin
 if viewer is null then raise exception 'Message send denied' using errcode='42501'; end if;
 if p_conversation_id is null or p_message_id is null or p_body is null
  or char_length(p_body) not between 1 and 4000 or p_body !~ '[^[:space:]]' then
  raise exception 'Invalid message input' using errcode='22023';
 end if;
 select * into thread from public.conversations where id=p_conversation_id;
 if not found or viewer not in (thread.owner_id,thread.requester_id) then
  raise exception 'Message send denied' using errcode='42501';
 end if;
 select flight_id into source_flight from public.flight_requests where id=thread.flight_request_id;
 -- Match request/flight lifecycle and the persistence trigger: flight, request,
 -- conversation, then authoritative membership share locks through commit.
 perform 1 from public.flights where id=source_flight for update;
 perform 1 from public.flight_requests where id=thread.flight_request_id for update;
 select * into thread from public.conversations where id=p_conversation_id for update;
 if not found or thread.closed_at is not null then raise exception 'Message send denied' using errcode='42501'; end if;
 perform 1 from public.memberships where user_id=thread.owner_id and status='active' for share;
 if not found then raise exception 'Message send denied' using errcode='42501'; end if;
 perform 1 from public.memberships where user_id=thread.requester_id and status='active' for share;
 if not found or public.get_flight_connection(thread.flight_request_id) is null then
  raise exception 'Message send denied' using errcode='42501';
 end if;
 insert into public.messages(id,conversation_id,sender_id,body)
 values(p_message_id,thread.id,viewer,p_body) on conflict(id) do nothing returning * into stored;
 if not found then
  select * into stored from public.messages where id=p_message_id and conversation_id=thread.id and sender_id=viewer and body=p_body;
  if not found then raise exception 'Message identity conflict' using errcode='22023'; end if;
 else
  -- Only a new message emits; an exact UUID retry returns its original receipt.
  insert into public.notifications(event_type,message_id) values('message_received',stored.id)
   on conflict(recipient_id,event_key) do nothing;
 end if;
 -- A fixed confirmation contains no message body or provider data. Exact retry
 -- returns the original identity/time and never edits or reorders history.
 return jsonb_build_object('id',stored.id,'conversationId',stored.conversation_id,'senderId',stored.sender_id,'createdAt',stored.created_at);
end;$$;
revoke all on function public.send_conversation_message(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.send_conversation_message(uuid,uuid,text) to authenticated;
comment on function public.send_conversation_message(uuid,uuid,text) is
 'Verified session identity only; sender is never an argument. Both active members and live accepted/open/PRIVATE connection plus unclosed conversation are checked under lifecycle locks, including on retry. Message UUID is an exact-payload retry identity scoped to conversation/sender/body; mismatches cannot overwrite or reveal another record. Fixed UUID/timestamp confirmation only. No direct table writes, service-role execute or edits/deletion. Future app wiring must enforce existing origin/input/no-store guards and escaped text rendering.';

