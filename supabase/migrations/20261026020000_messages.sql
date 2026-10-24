-- VOLO-205: initial message persistence; no send API exposed before VOLO-81.
create table public.messages (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations(id) on delete restrict,
 sender_id uuid not null references public.memberships(user_id) on delete restrict,
 body text not null,
 created_at timestamptz not null default clock_timestamp(),
 constraint messages_body_length check (char_length(body) between 1 and 4000),
 constraint messages_body_nonblank check (body ~ '[^[:space:]]')
);
create index messages_conversation_order on public.messages(conversation_id,created_at,id);
alter table public.messages enable row level security;
revoke all on public.messages from public,anon,authenticated,service_role;
grant select on public.messages to authenticated,service_role;
create policy messages_read_participant on public.messages for select to authenticated using (
 -- The conversation's RLS checks the active viewer and immutable participant pair.
 -- It intentionally preserves history after closure or PRIVATE selection removal.
 exists(select 1 from public.conversations c where c.id=conversation_id)
);

create function flight_private.prepare_message()
returns trigger language plpgsql security definer set search_path='' as $$
declare viewer uuid:=(select auth.uid()); thread public.conversations%rowtype; flight_id uuid;
begin
 if tg_op='UPDATE' then raise exception 'Messages are immutable' using errcode='23514'; end if;
 if viewer is null or new.sender_id is distinct from viewer then
  raise exception 'Message persistence denied' using errcode='42501';
 end if;
 -- Find immutable linkage without taking a conversation-first lock. Every future
 -- send must keep the common flight -> request -> conversation lock order.
 select * into thread from public.conversations where id=new.conversation_id;
 if not found or viewer not in (thread.owner_id,thread.requester_id) then
  raise exception 'Message persistence denied' using errcode='42501';
 end if;
 select r.flight_id into flight_id from public.flight_requests r where r.id=thread.flight_request_id;
 perform 1 from public.flights f where f.id=flight_id for update;
 perform 1 from public.flight_requests r where r.id=thread.flight_request_id for update;
 select * into thread from public.conversations where id=new.conversation_id for update;
 if not found or thread.closed_at is not null then raise exception 'Message persistence denied' using errcode='42501'; end if;
 -- Membership locks fence disablement through commit. Reuse the authoritative
 -- accepted/open/current-PRIVATE-selection predicate; profile/departure add no gate.
 perform 1 from public.memberships where user_id=thread.owner_id and status='active' for share;
 if not found then raise exception 'Message persistence denied' using errcode='42501'; end if;
 perform 1 from public.memberships where user_id=thread.requester_id and status='active' for share;
 if not found or public.get_flight_connection(thread.flight_request_id) is null then
  raise exception 'Message persistence denied' using errcode='42501';
 end if;
 -- Take time after waiting for lifecycle locks; ignore caller-supplied chronology.
 new.created_at:=greatest(clock_timestamp(),thread.created_at);
 return new;
end;$$;
revoke all on function flight_private.prepare_message() from public,anon,authenticated,service_role;
create trigger messages_prepare before insert or update on public.messages for each row execute function flight_private.prepare_message();
comment on table public.messages is
 'Immutable 1–4,000-character plain-text history, UUID identity and server-managed timestamp. Active conversation participants read retained history through conversation RLS, including closed/removed PRIVATE requests, without flight visibility or admin bypass. No client or service-role write grants; VOLO-81 must expose only guarded authenticated sending.';
comment on column public.messages.created_at is
 'Server time after common lifecycle flight/request/conversation locks, clamped to conversation creation. Immutable; order and keyset page by (created_at,id) within conversation. Not a network-delivery ordering guarantee.';
comment on column public.messages.body is
 'Plain text preserved as submitted, at least one PostgreSQL non-whitespace character, maximum 4,000 Unicode characters. Future UI must render as escaped text, never HTML.';
comment on function flight_private.prepare_message() is
 'Persistence defense even for privileged inserts: authenticated sender must equal immutable participant; flight/request/conversation locks, both active memberships and live accepted/open/PRIVATE predicate plus closed_at checked. No direct execution or send API. All UPDATE rejected; history DELETE grants remain closed.';
