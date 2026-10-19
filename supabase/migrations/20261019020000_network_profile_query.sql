-- VOLO-168: direct reads must enforce the same target eligibility as directory pages.
create function public.get_network_profile(p_user_id uuid)
returns table (
  user_id uuid, display_name text, home_airport text,
  pilot_designation public.pilot_designation, certificates text[], ratings text[],
  aircraft_access text, flying_interests text, bio text, photo_available boolean
)
language sql stable security invoker
set search_path = ''
as $$
  select p.user_id, p.display_name, p.home_airport, p.pilot_designation,
    p.certificates, p.ratings, p.aircraft_access, p.flying_interests, p.bio,
    p.photo_storage_path is not null
  from public.profiles p
  where p.user_id = p_user_id
    and p.pilot_designation = 'licensed'
    and directory_private.active_profile_owner(p.user_id);
$$;
revoke all on function public.get_network_profile(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_network_profile(uuid) to authenticated;
comment on function public.get_network_profile(uuid) is
  'One active licensed pilot profile for an active member; existing profile RLS applies. No account email, membership metadata or Storage paths.';
