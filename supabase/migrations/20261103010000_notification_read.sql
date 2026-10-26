-- VOLO-221: one-way server-owned read markers; direct app-role writes stay closed.
create or replace function notification_private.prepare_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid; request public.flight_requests%rowtype; message public.messages%rowtype;
 thread public.conversations%rowtype; key text;
begin
 if tg_op='UPDATE' then
  if (to_jsonb(new)-'read_at') is distinct from (to_jsonb(old)-'read_at')
   or old.read_at is not null or new.read_at is null then
   raise exception 'Notification metadata is immutable' using errcode='23514';
  end if;
  if (select auth.uid()) is distinct from old.recipient_id then
   raise exception 'Notification mark denied' using errcode='42501';
  end if;
  perform 1 from public.memberships where user_id=old.recipient_id and status='active' for share;
  if not found then raise exception 'Notification mark denied' using errcode='42501'; end if;
  new.read_at:=clock_timestamp();
  return new;
 end if;
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

create function public.mark_notification_read(p_notification_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare viewer uuid:=(select auth.uid()); notice public.notifications%rowtype;
begin
 if viewer is null then raise exception 'Notification mark denied' using errcode='42501'; end if;
 -- Fence disablement through commit before locking the recipient's notification.
 perform 1 from public.memberships where user_id=viewer and status='active' for share;
 if not found then raise exception 'Notification mark denied' using errcode='42501'; end if;
 if p_notification_id is null then raise exception 'Invalid notification input' using errcode='22023'; end if;
 select * into notice from public.notifications where id=p_notification_id and recipient_id=viewer for update;
 if not found then return jsonb_build_object('code','notification_unavailable'); end if;
 if notice.read_at is null then
  update public.notifications set read_at=clock_timestamp() where id=notice.id returning * into notice;
 end if;
 return jsonb_build_object('code','read','id',notice.id,'readAt',notice.read_at);
end;$$;
revoke all on function public.mark_notification_read(uuid) from public,anon,authenticated,service_role;
grant execute on function public.mark_notification_read(uuid) to authenticated;
comment on function public.mark_notification_read(uuid) is
 'Only the active auth.uid() recipient can set a first server-owned read marker under membership/notification locks. Matching retries return the original ID/time. Unknown and foreign records share one safe outcome; admins have no bypass. No caller recipient, timestamp, unread reset or metadata edits.';
comment on function notification_private.prepare_notification() is
 'Unexposed source/recipient/event validation for inserts. Updates permit only an active recipient first read marker with server time; all event/source/identity/chronology metadata and existing read markers are immutable. Direct app-role mutation grants remain closed.';
comment on table public.notifications is
 'Recipient-only in-app event references generated atomically by owning operations. Active recipient SELECT and guarded mark_notification_read only; no admin/service bypass, copied private content, URL payload or duplicate unread store. References grant no target access.';
