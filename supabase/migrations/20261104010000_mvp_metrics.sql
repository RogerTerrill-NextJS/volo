-- VOLO-223: one aggregate report, no new events or source-table access grants.
create function public.admin_mvp_metrics()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 -- Match the existing admin report boundary and fence role/status changes.
 perform 1 from public.memberships
  where user_id=(select auth.uid()) and role='admin' and status='active' for share;
 if not found then raise exception 'Metrics unavailable' using errcode='42501'; end if;
 -- One SELECT gives all aggregates one source snapshot. Existing source rows
 -- remain protected: no identity, text, route, recipient or message body is returned.
 select jsonb_build_object(
  'asOf',statement_timestamp(),
  'invitedPilots',(select count(distinct i.recipient_email_key) from public.invitations i where exists(
   select 1 from public.invitation_send_attempts a where a.invitation_id=i.id
    and coalesce(a.reconciled_outcome::text,a.outcome::text)='accepted')),
  'activatedPilots',(select count(distinct auth_user_id) from public.invitations where status='redeemed'),
  'activeMembers',(select count(*) from public.memberships where status='active'),
  'completedProfiles',(select count(*) from public.profiles),
  'activeProfiles',(select count(*) from public.profiles p join public.memberships m on m.user_id=p.user_id where m.status='active'),
  'flightPosts',(select count(*) from public.flights),
  'interestRequests',(select count(*) from public.flight_requests),
  'currentAcceptedRequests',(select count(*) from public.flight_requests where status='accepted'),
  'recordedAcceptedRequests',(select count(*) from public.flight_requests r where r.status='accepted'
   or exists(select 1 from public.notifications n where n.request_id=r.id and n.event_type='request_accepted')
   or exists(select 1 from public.conversations c where c.flight_request_id=r.id)),
  'messages',(select count(*) from public.messages),
  'messagingConversations',(select count(distinct conversation_id) from public.messages),
  'outcomes','not_collected'
 ) into result;
 return result;
end;$$;
revoke all on function public.admin_mvp_metrics() from public,anon,authenticated,service_role;
grant execute on function public.admin_mvp_metrics() to authenticated;
comment on function public.admin_mvp_metrics() is
 'Active current admin only; aggregate all-time retained-record snapshot, no raw private data or source-table grant. Invited recipients deduplicate accepted/reconciled provider sends (not delivery); activation uses redeemed subjects. Profiles are schema-complete; active profiles/members are current gauges. Posts and requests count retained records once, including hidden/closed history and resubmission. Recorded acceptance is distinct requests evidenced by current acceptance, accepted notification or conversation, not event count; earlier closed history without evidence is unrecoverable. Messages and messaging conversations are unique retained records. Real-world participant outcomes are not collected, never inferred from acceptance or messaging.';
