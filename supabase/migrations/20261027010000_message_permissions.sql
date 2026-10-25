-- VOLO-206: guarded session-only sends; direct message mutations remain closed.
create function public.send_conversation_message(p_conversation_id uuid,p_message_id uuid,p_body text)
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
 end if;
 -- A fixed confirmation contains no message body or provider data. Exact retry
 -- returns the original identity/time and never edits or reorders history.
 return jsonb_build_object('id',stored.id,'conversationId',stored.conversation_id,'senderId',stored.sender_id,'createdAt',stored.created_at);
end;$$;
revoke all on function public.send_conversation_message(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.send_conversation_message(uuid,uuid,text) to authenticated;
comment on function public.send_conversation_message(uuid,uuid,text) is
 'Verified session identity only; sender is never an argument. Both active members and live accepted/open/PRIVATE connection plus unclosed conversation are checked under lifecycle locks, including on retry. Message UUID is an exact-payload retry identity scoped to conversation/sender/body; mismatches cannot overwrite or reveal another record. Fixed UUID/timestamp confirmation only. No direct table writes, service-role execute or edits/deletion. Future app wiring must enforce existing origin/input/no-store guards and escaped text rendering.';

-- Postgres Changes INSERT/UPDATE obey SELECT RLS, while DELETE cannot authorize
-- a removed row. Publish INSERT only; messages are immutable and retained.
-- Refuse to change operation settings for any unrelated configured stream.
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime' and puballtables)
  or exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and (schemaname<>'public' or tablename<>'messages')) then
  raise exception 'Unexpected shared Realtime publication' using errcode='55000';
 end if;
 if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
  create publication supabase_realtime for table public.messages with(publish='insert');
 else
  alter publication supabase_realtime set(publish='insert');
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages') then
   alter publication supabase_realtime add table public.messages;
  end if;
 end if;
end;$$;
comment on publication supabase_realtime is
 'VOLO-206: only protected public.messages INSERT events. Delivery uses current participant SELECT RLS; no DELETE/UPDATE/TRUNCATE payloads or broadcast/presence data. Expanding this stream requires an explicit access review.';
comment on table public.messages is
 'Immutable bounded plain-text history. Active conversation participants read retained history through RLS, even after closure/PRIVATE removal, without current flight access or admin bypass. Direct member/service-role mutation grants stay closed; authenticated send_conversation_message derives identity and checks current writable state under lifecycle locks. Realtime publishes only INSERT through the same SELECT policies.';
