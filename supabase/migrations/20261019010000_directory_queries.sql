-- VOLO-166: all active members with licensed profiles are directory eligible.
-- Keep the membership predicate outside PostgREST's exposed public schema.
create schema directory_private;
revoke all on schema directory_private from public, anon, authenticated, service_role;
grant usage on schema directory_private to authenticated;

create function directory_private.active_profile_owner(owner_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships
    where user_id = (select auth.uid()) and status = 'active'
  ) and exists (
    select 1 from public.memberships
    where user_id = owner_id and status = 'active'
  );
$$;
revoke all on function directory_private.active_profile_owner(uuid) from public, anon, authenticated, service_role;
grant execute on function directory_private.active_profile_owner(uuid) to authenticated;

-- Invoker execution is essential: the existing profiles SELECT RLS still applies.
-- One extra eligible row lets the server determine whether another page exists.
create function public.list_directory_profiles(p_after uuid default null, p_page_size integer default 20)
returns table (
  user_id uuid, display_name text, home_airport text,
  pilot_designation public.pilot_designation, certificates text[], ratings text[],
  aircraft_access text, flying_interests text, bio text, photo_available boolean
)
language plpgsql stable security invoker
set search_path = ''
as $$
begin
  if p_page_size is null or p_page_size < 1 or p_page_size > 50 then
    raise exception 'Invalid directory page size' using errcode = '22023';
  end if;
  return query
    select p.user_id, p.display_name, p.home_airport, p.pilot_designation,
      p.certificates, p.ratings, p.aircraft_access, p.flying_interests, p.bio,
      p.photo_storage_path is not null
    from public.profiles p
    where (p_after is null or p.user_id > p_after)
      and p.pilot_designation = 'licensed'
      and directory_private.active_profile_owner(p.user_id)
    order by p.user_id
    limit (p_page_size + 1);
end;
$$;
revoke all on function public.list_directory_profiles(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.list_directory_profiles(uuid, integer) to authenticated;
comment on function public.list_directory_profiles(uuid, integer) is
  'Member-visible profile fields only; active licensed-profile owners; UUID cursor; up to page size plus one lookahead row. No opt-out in VOLO-166.';
