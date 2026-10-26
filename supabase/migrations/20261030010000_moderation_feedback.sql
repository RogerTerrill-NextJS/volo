-- VOLO-216: reveal only a hidden-state notice to the existing affected pair.
create function public.is_flight_hidden_for_participant(p_flight_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.flights f
  join public.memberships m on m.user_id=(select auth.uid()) and m.status='active'
  where f.id=p_flight_id and f.moderated_at is not null
   and (f.owner_id=m.user_id or exists(
    select 1 from public.flight_requests r where r.flight_id=f.id and r.requester_id=m.user_id and r.status='cancelled'
   ))
 );
$$;
revoke all on function public.is_flight_hidden_for_participant(uuid) from public,anon,authenticated,service_role;
grant execute on function public.is_flight_hidden_for_participant(uuid) to authenticated;
comment on function public.is_flight_hidden_for_participant(uuid) is
 'Read-only scalar notice for active actual owner or requester with cancelled history. All unrelated viewers (including admins), unadmitted/disabled viewers, missing/non-hidden targets return false. No post details, moderator identity, reason, audience or conversation contents; does not widen ordinary flight/history RLS or grant messaging. Used after independently authorized detail/closed-request reads.';
