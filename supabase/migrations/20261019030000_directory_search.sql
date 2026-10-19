-- VOLO-169: literal normalized name/airport search within the eligible directory.
-- Replace the two-argument signature to avoid ambiguous defaulted RPC overloads.
-- Existing callers may omit search and retain the unfiltered directory behavior.
drop function public.list_directory_profiles(uuid, integer);

create function public.list_directory_profiles(p_after uuid default null, p_page_size integer default 20, p_search text default '')
returns table (
  user_id uuid, display_name text, home_airport text,
  pilot_designation public.pilot_designation, certificates text[], ratings text[],
  aircraft_access text, flying_interests text, bio text, photo_available boolean
)
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  term text;
  whitespace text := U&'[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+';
begin
  if p_page_size is null or p_page_size < 1 or p_page_size > 50 then
    raise exception 'Invalid directory page size' using errcode = '22023';
  end if;
  if p_search is null or char_length(p_search) > 80 then
    raise exception 'Invalid directory search' using errcode = '22023';
  end if;
  term := lower(btrim(regexp_replace(p_search, whitespace, ' ', 'g')));
  return query
    select p.user_id, p.display_name, p.home_airport, p.pilot_designation,
      p.certificates, p.ratings, p.aircraft_access, p.flying_interests, p.bio,
      p.photo_storage_path is not null
    from public.profiles p
    where (p_after is null or p.user_id > p_after)
      and p.pilot_designation = 'licensed'
      and directory_private.active_profile_owner(p.user_id)
      and (term = ''
        or strpos(lower(btrim(regexp_replace(p.display_name, whitespace, ' ', 'g'))), term) > 0
        or strpos(lower(p.home_airport), term) > 0)
    order by p.user_id
    limit (p_page_size + 1);
end;
$$;
revoke all on function public.list_directory_profiles(uuid, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.list_directory_profiles(uuid, integer, text) to authenticated;
comment on function public.list_directory_profiles(uuid, integer, text) is
  'Public profile fields for active licensed members; literal case-insensitive name/airport search, bounded input and UUID pagination. Caller RLS applies.';
