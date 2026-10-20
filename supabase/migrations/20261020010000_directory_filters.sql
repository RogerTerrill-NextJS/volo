-- VOLO-170: combined filters over existing self-reported public profile fields.
-- One signature keeps PostgREST resolution unambiguous; omitted criteria stay blank.
drop function public.list_directory_profiles(uuid, integer, text);

create function public.list_directory_profiles(p_after uuid default null, p_page_size integer default 20, p_search text default '', p_certificate text default '', p_rating text default '', p_aircraft text default '')
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
  certificate_term text;
  rating_term text;
  aircraft_term text;
  criterion text;
  whitespace text := U&'[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+';
begin
  if p_page_size is null or p_page_size < 1 or p_page_size > 50 then
    raise exception 'Invalid directory page size' using errcode = '22023';
  end if;
  foreach criterion in array array[p_search,p_certificate,p_rating,p_aircraft] loop
    if criterion is null or char_length(criterion) > 80 then
      raise exception 'Invalid directory criteria' using errcode = '22023';
    end if;
  end loop;
  term := lower(btrim(regexp_replace(p_search, whitespace, ' ', 'g')));
  certificate_term := lower(btrim(regexp_replace(p_certificate, whitespace, ' ', 'g')));
  rating_term := lower(btrim(regexp_replace(p_rating, whitespace, ' ', 'g')));
  aircraft_term := lower(btrim(regexp_replace(p_aircraft, whitespace, ' ', 'g')));
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
      and (certificate_term = '' or exists (
        select 1 from unnest(p.certificates) as c(label)
        where strpos(lower(btrim(regexp_replace(c.label, whitespace, ' ', 'g'))), certificate_term) > 0
      ))
      and (rating_term = '' or exists (
        select 1 from unnest(p.ratings) as r(label)
        where strpos(lower(btrim(regexp_replace(r.label, whitespace, ' ', 'g'))), rating_term) > 0
      ))
      and (aircraft_term = '' or strpos(lower(btrim(regexp_replace(p.aircraft_access, whitespace, ' ', 'g'))), aircraft_term) > 0)
    order by p.user_id
    limit (p_page_size + 1);
end;
$$;
revoke all on function public.list_directory_profiles(uuid, integer, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.list_directory_profiles(uuid, integer, text, text, text, text) to authenticated;
comment on function public.list_directory_profiles(uuid, integer, text, text, text, text) is
  'Public profiles for active licensed members; normalized literal name/airport search AND certificate, rating and aircraft substrings before bounded UUID pagination. Caller RLS applies.';
