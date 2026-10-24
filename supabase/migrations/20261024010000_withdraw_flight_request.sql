-- VOLO-195: approved pending/accepted withdrawal and eligible same-record resubmission.
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
  -- No conversations exist yet. Their migration must integrate atomic sending
  -- closure before permitting accepted withdrawal with that schema present.
  if old.status='accepted' and new.status='withdrawn' and to_regclass('public.conversations') is not null then
   raise exception 'Withdrawal lifecycle unavailable' using errcode='55000';
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

create function public.withdraw_flight_request(p_flight_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare viewer uuid := (select auth.uid()); request public.flight_requests%rowtype;
begin
 if viewer is null then raise exception 'Request withdrawal denied' using errcode='42501'; end if;
 perform 1 from public.memberships where user_id=viewer and status='active' for share;
 if not found then raise exception 'Request withdrawal denied' using errcode='42501'; end if;
 if p_flight_id is null or p_request_id is null then
  raise exception 'Invalid request withdrawal' using errcode='22023';
 end if;
 -- Common protocol: flight before request. Do not require current flight/profile
 -- eligibility for terminal closure of the requester's own retained history.
 perform 1 from public.flights where id=p_flight_id for update;
 if not found then return jsonb_build_object('code','request_unavailable'); end if;
 select * into request from public.flight_requests
  where id=p_request_id and flight_id=p_flight_id and requester_id=viewer for update;
 if not found then return jsonb_build_object('code','request_unavailable'); end if;
 if request.status='withdrawn' then
  return jsonb_build_object('code','already_withdrawn','requestId',request.id,'status','withdrawn');
 end if;
 if request.status not in ('pending','accepted') then
  return jsonb_build_object('code','request_conflict');
 end if;
 -- The persistence trigger fences accepted withdrawal if conversations are
 -- introduced without their required atomic send closure. No messages exist now.
 update public.flight_requests set status='withdrawn' where id=request.id;
 return jsonb_build_object('code','withdrawn','requestId',request.id,'status','withdrawn');
end;$$;
revoke all on function public.withdraw_flight_request(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.withdraw_flight_request(uuid,uuid) to authenticated;
comment on function public.withdraw_flight_request(uuid,uuid) is
 'Active requester from auth.uid() only; no owner/admin bypass. Flight lock before request bound to flight and actor. Pending/accepted -> withdrawn releases derived accepted capacity and retains identity/note/history. Withdrawn retry is immutable no-op; declined/cancelled conflict. No current flight/profile/selection eligibility required for closure. Conversation introduction must integrate atomic send closure before replacing persistence fence. Resubmission uses submit_flight_interest with fresh eligibility and returns same record to pending for owner approval.';
comment on column public.flight_requests.status is
 'Initially pending. Pending -> accepted/declined/withdrawn/cancelled; accepted -> withdrawn/cancelled; withdrawn -> pending with fresh eligibility and owner approval. Declined/cancelled terminal. Accepted withdrawal requires atomic sending closure when conversations exist.';
