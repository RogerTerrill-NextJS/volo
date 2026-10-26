-- VOLO-219: persistence only. Owning operation generation is VOLO-220.
create schema notification_private;
revoke all on schema notification_private from public,anon,authenticated,service_role;
create table public.notifications (
 id uuid primary key default gen_random_uuid(),
 recipient_id uuid not null references public.memberships(user_id) on delete restrict,
 event_type text not null check(event_type in ('request_received','request_accepted','message_received')),
 event_key text not null check(char_length(event_key) between 1 and 160),
 request_id uuid references public.flight_requests(id) on delete restrict,
 message_id uuid references public.messages(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp() check(isfinite(created_at)),
 read_at timestamptz check(read_at is null or (isfinite(read_at) and read_at>=created_at)),
 constraint notifications_target_kind check (
  (event_type in ('request_received','request_accepted') and request_id is not null and message_id is null)
  or (event_type='message_received' and message_id is not null and request_id is null)
 ),
 constraint notifications_recipient_event unique(recipient_id,event_key)
);
create index notifications_recipient_order on public.notifications(recipient_id,created_at desc,id desc);
alter table public.notifications enable row level security;
revoke all on public.notifications from public,anon,authenticated,service_role;
grant select on public.notifications to authenticated;
create policy notifications_read_recipient on public.notifications for select to authenticated using (
 recipient_id=(select auth.uid()) and exists(
  select 1 from public.memberships m where m.user_id=(select auth.uid()) and m.status='active'
 )
);

create function notification_private.prepare_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid; request public.flight_requests%rowtype; message public.messages%rowtype;
 thread public.conversations%rowtype; key text;
begin
 if tg_op='UPDATE' then raise exception 'Notification metadata is immutable' using errcode='23514'; end if;
 if new.read_at is not null then raise exception 'Notifications start unread' using errcode='23514'; end if;
 if new.event_type in ('request_received','request_accepted') and new.request_id is not null and new.message_id is null then
  -- Freeze the source occurrence through commit. Owning operations already use
  -- flight -> request -> membership; this adds no membership-to-source inversion.
  select * into request from public.flight_requests where id=new.request_id for share;
  if not found then raise exception 'Notification source unavailable' using errcode='23503'; end if;
  if (new.event_type='request_received' and request.status<>'pending')
   or (new.event_type='request_accepted' and request.status<>'accepted') then
   raise exception 'Notification source state mismatch' using errcode='23514';
  end if;
  if new.event_type='request_received' then
   select owner_id into recipient from public.flights where id=request.flight_id;
  else recipient:=request.requester_id; end if;
  -- The same request UUID may be withdrawn and resubmitted/reaccepted. Each
  -- server-owned status occurrence is distinct; retrying it keeps this key.
  key:=new.event_type||':'||request.id::text||':'||to_char(request.status_changed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
 elsif new.event_type='message_received' and new.message_id is not null and new.request_id is null then
  select * into message from public.messages where id=new.message_id for share;
  if not found then raise exception 'Notification source unavailable' using errcode='23503'; end if;
  select * into thread from public.conversations where id=message.conversation_id;
  if message.sender_id=thread.owner_id then recipient:=thread.requester_id;
  elsif message.sender_id=thread.requester_id then recipient:=thread.owner_id;
  else raise exception 'Notification participant mismatch' using errcode='23514'; end if;
  key:='message_received:'||message.id::text;
 else raise exception 'Notification target mismatch' using errcode='23514';
 end if;
 if new.recipient_id is not null and new.recipient_id<>recipient then
  raise exception 'Notification recipient mismatch' using errcode='23514';
 end if;
 perform 1 from public.memberships where user_id=recipient and status='active' for share;
 if not found then raise exception 'Notification recipient unavailable' using errcode='23514'; end if;
 new.recipient_id:=recipient;new.event_key:=key;new.created_at:=clock_timestamp();new.read_at:=null;
 return new;
end;$$;
revoke all on function notification_private.prepare_notification() from public,anon,authenticated,service_role;
create trigger notifications_prepare before insert or update on public.notifications for each row execute function notification_private.prepare_notification();
comment on table public.notifications is
 'Recipient-only in-app event references. Only the current active recipient SELECTs; no administrator or service-role bypass, copied content, URL payload, automatic generation/backfill, public writer or mark-read API. VOLO-220 inserts inside owning operations; VOLO-221 adds guarded read markers without widening metadata writes. References retain history and grant no target access.';
comment on column public.notifications.event_key is
 'Canonical server-derived identity, unique per recipient. Request events bind type, request UUID and server status_changed_at occurrence; message events bind type and immutable message UUID. Owning operations use ON CONFLICT(recipient_id,event_key) DO NOTHING; retries preserve the original row/time/read state. Eligible resubmission and reacceptance are new occurrences, not duplicates.';
comment on function notification_private.prepare_notification() is
 'Unexposed persistence boundary for three MVP events. Validates typed source combination/current request state, derives owner/requester/opposite-message-participant recipient and canonical key, fences current recipient membership, forces server chronology and unread initial state, rejects updates. No app-role execution or generic delivery engine; generation remains with owning operations.';
