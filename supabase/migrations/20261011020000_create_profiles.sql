-- VOLO-159: member-visible, self-reported pilot information.
-- Identity and admission remain with auth.users and memberships.
create type public.pilot_designation as enum ('student', 'licensed');

-- A CHECK cannot contain a subquery; this pure predicate bounds both label lists.
create function public.profile_labels_valid(labels text[])
returns boolean
language sql immutable strict
set search_path = ''
as $$
  select cardinality(labels) <= 20
    and (cardinality(labels) = 0
      or (array_ndims(labels) = 1 and array_lower(labels, 1) = 1))
    and not exists (
      select 1 from unnest(labels) as entry
      where entry is null
        or char_length(entry) not between 1 and 80
        or entry !~ '[^[:space:]]'
        or entry ~ '^[[:space:]]|[[:space:]]$'
    );
$$;
revoke all on function public.profile_labels_valid(text[]) from public, anon, authenticated, service_role;
grant execute on function public.profile_labels_valid(text[]) to authenticated, service_role;

create table public.profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete restrict,
  display_name text not null,
  home_airport text not null,
  pilot_designation public.pilot_designation not null,
  certificates text[] not null default '{}',
  ratings text[] not null default '{}',
  aircraft_access text,
  flying_interests text,
  bio text,
  photo_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name check (
    char_length(display_name) between 1 and 80
    and display_name ~ '[^[:space:]]'
    and display_name !~ '^[[:space:]]|[[:space:]]$'
  ),
  constraint profiles_home_airport check (home_airport ~ '^[A-Z0-9]{2,8}$'),
  constraint profiles_certificates check (public.profile_labels_valid(certificates)),
  constraint profiles_ratings check (public.profile_labels_valid(ratings)),
  constraint profiles_aircraft_access check (char_length(aircraft_access) <= 500),
  constraint profiles_flying_interests check (char_length(flying_interests) <= 500),
  constraint profiles_bio check (char_length(bio) <= 2000),
  constraint profiles_photo_storage_path check (
    char_length(photo_storage_path) between 1 and 1024
    and photo_storage_path ~ '[^[:space:]]'
  )
);

create function public.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
revoke all on function public.set_profile_updated_at() from public, anon, authenticated, service_role;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_profile_updated_at();

alter table public.profiles enable row level security;
revoke all on table public.profiles from public, anon, authenticated, service_role;
grant select on table public.profiles to authenticated;
-- auth.uid() supplies identity on insert; clients cannot supply identity or timestamps.
grant insert (display_name, home_airport, pilot_designation, certificates, ratings,
  aircraft_access, flying_interests, bio, photo_storage_path)
  on public.profiles to authenticated;
grant update (display_name, home_airport, pilot_designation, certificates, ratings,
  aircraft_access, flying_interests, bio, photo_storage_path)
  on public.profiles to authenticated;
grant select, insert, update on table public.profiles to service_role;
revoke all on type public.pilot_designation from public, anon;
grant usage on type public.pilot_designation to authenticated, service_role;

create policy profiles_read_active_member
  on public.profiles for select to authenticated
  using (exists (
    select 1 from public.memberships
    where user_id = (select auth.uid()) and status = 'active'
  ));
create policy profiles_insert_owner
  on public.profiles for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.memberships
    where user_id = (select auth.uid()) and status = 'active'
  ));
create policy profiles_update_owner
  on public.profiles for update to authenticated
  using (user_id = (select auth.uid()) and exists (
    select 1 from public.memberships
    where user_id = (select auth.uid()) and status = 'active'
  ))
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.memberships
    where user_id = (select auth.uid()) and status = 'active'
  ));

comment on table public.profiles is
  'Self-reported pilot information, readable by active members and editable only by its active owner. No email, role or membership state.';
comment on column public.profiles.home_airport is
  'Normalized 2-8 character alphanumeric identifier; format does not establish that an airport exists.';
comment on column public.profiles.photo_storage_path is
  'Optional Storage object path; bucket, object authorization and upload validation belong to VOLO-36.';
-- No automatic profile creation, delete policy, Storage bucket or Realtime publication.
