begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Independent of seeds; removing the migration must fail this first assertion.
select has_table('public', 'profiles', 'Profiles are persisted');

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'profile-admin@example.invalid'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'profile-owner@example.invalid'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'profile-disabled@example.invalid'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'profile-unadmitted@example.invalid'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'profile-licensed@example.invalid');
insert into public.memberships (user_id, role, status, disabled_at, disabled_reason) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin', 'active', null, null),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'member', 'active', null, null),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'member', 'disabled', now(), 'Test fixture'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'member', 'active', null, null);
insert into public.profiles (user_id, display_name, home_airport, pilot_designation) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Admin Pilot', 'KPAO', 'licensed'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Disabled Pilot', 'SQL', 'licensed');

set local role anon;
select throws_ok('select * from public.profiles', '42501', null, 'Anonymous profile reads denied');
select throws_ok($$insert into public.profiles (display_name, home_airport, pilot_designation) values ('Anon', 'KPAO', 'licensed')$$, '42501', null, 'Anonymous profile writes denied');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}', true);
select lives_ok($$insert into public.profiles (display_name, home_airport, pilot_designation) values ('Owner Pilot', 'KPAO', 'licensed')$$, 'Active owner creates profile using authenticated identity');
select is((select count(*)::integer from public.profiles where user_id in (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc')), 3, 'Active member reads network profiles');
select is((select certificates from public.profiles where user_id = auth.uid()), '{}'::text[], 'Certificates can be omitted');
select throws_ok($$insert into public.profiles (display_name, home_airport, pilot_designation) values ('Duplicate', 'KPAO', 'licensed')$$, '23505', null, 'Only one profile per identity');
select throws_ok($$insert into public.profiles (user_id, display_name, home_airport, pilot_designation) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Impersonated', 'KPAO', 'licensed')$$, '42501', null, 'Client cannot supply another profile identity');
select set_config('volo.profile_initial_updated_at', (select updated_at::text from public.profiles where user_id = auth.uid()), true);
select lives_ok($$update public.profiles set certificates = array['Private pilot'], ratings = array['Instrument'], aircraft_access = 'Flying club C172', flying_interests = 'Day trips', bio = 'Local pilot' where user_id = auth.uid()$$, 'Owner updates permitted optional fields');
select cmp_ok((select updated_at from public.profiles where user_id = auth.uid()), '>', current_setting('volo.profile_initial_updated_at')::timestamptz, 'Profile edits advance server-managed update time');
select is((select bio from public.profiles where user_id = auth.uid()), 'Local pilot', 'Owner update persists');
with changed as (update public.profiles set bio = 'Cross-owner edit' where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' returning user_id)
select is((select count(*)::integer from changed), 0, 'Cross-owner update changes no rows');
select throws_ok($$update public.profiles set user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' where user_id = auth.uid()$$, '42501', null, 'Owner cannot transfer profile identity');
select throws_ok('update public.profiles set created_at = now()', '42501', null, 'Owner cannot rewrite creation time');
select throws_ok('update public.profiles set updated_at = now()', '42501', null, 'Owner cannot supply update time');
select throws_ok($$insert into public.profiles (display_name, home_airport, pilot_designation, created_at) values ('Timestamp spoof', 'KPAO', 'licensed', now())$$, '42501', null, 'Client cannot supply creation time');
select throws_ok('delete from public.profiles where user_id = auth.uid()', '42501', null, 'Account deletion is not a profile edit');
select throws_ok($$update public.memberships set role = 'admin', status = 'active' where user_id = auth.uid()$$, '42501', null, 'Profile owner cannot edit membership or promote self');

-- Actual database constraints, including successful maximum-length values.
select lives_ok($$update public.profiles set display_name = repeat('N', 80), home_airport = 'AB12CD34', certificates = array_fill(repeat('C', 80), array[20]), ratings = array_fill(repeat('R', 80), array[20]), aircraft_access = repeat('A', 500), flying_interests = repeat('I', 500), bio = repeat('B', 2000) where user_id = auth.uid()$$, 'Approved field limits are accepted');
select throws_ok($$update public.profiles set display_name = repeat('N', 81) where user_id = auth.uid()$$, '23514', null, 'Overlong display name rejected');
select throws_ok($$update public.profiles set display_name = E' \t\n' where user_id = auth.uid()$$, '23514', null, 'Whitespace-only name rejected');
select throws_ok('update public.profiles set home_airport = null where user_id = auth.uid()', '23502', null, 'Home airport required');
select throws_ok($$update public.profiles set home_airport = 'kpao' where user_id = auth.uid()$$, '23514', null, 'Airport must be normalized uppercase');
select throws_ok($$update public.profiles set home_airport = 'A' where user_id = auth.uid()$$, '23514', null, 'Airport minimum enforced');
select throws_ok($$update public.profiles set home_airport = 'ABCDEFGHI' where user_id = auth.uid()$$, '23514', null, 'Airport maximum enforced');
select throws_ok($$update public.profiles set home_airport = 'AB-CD' where user_id = auth.uid()$$, '23514', null, 'Airport punctuation rejected');
select throws_ok('update public.profiles set pilot_designation = null where user_id = auth.uid()', '23502', null, 'Pilot designation required');
select throws_ok($$update public.profiles set certificates = array_fill('Private'::text, array[21]) where user_id = auth.uid()$$, '23514', null, 'Certificate count bounded');
select throws_ok($$update public.profiles set ratings = array[repeat('R', 81)] where user_id = auth.uid()$$, '23514', null, 'Rating length bounded');
select throws_ok($$update public.profiles set certificates = array[null]::text[] where user_id = auth.uid()$$, '23514', null, 'Null certificate entries rejected');
select throws_ok($$update public.profiles set ratings = array[E' \t'] where user_id = auth.uid()$$, '23514', null, 'Blank rating entries rejected');
select throws_ok($$update public.profiles set ratings = array[['Instrument']] where user_id = auth.uid()$$, '23514', null, 'Nested lists rejected');
select throws_ok($$update public.profiles set aircraft_access = repeat('A', 501) where user_id = auth.uid()$$, '23514', null, 'Aircraft access bounded');
select throws_ok($$update public.profiles set flying_interests = repeat('I', 501) where user_id = auth.uid()$$, '23514', null, 'Interests bounded');
select throws_ok($$update public.profiles set bio = repeat('B', 2001) where user_id = auth.uid()$$, '23514', null, 'Bio bounded');
select lives_ok('update public.profiles set aircraft_access = null, flying_interests = null, bio = null where user_id = auth.uid()', 'Optional text can be cleared');

select set_config('request.jwt.claims', '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated"}', true);
select throws_ok($$insert into public.profiles (display_name, home_airport, pilot_designation) values ('Student', 'S1', 'student')$$, '23514', null, 'Student profile creation rejected');
select lives_ok($$insert into public.profiles (display_name, home_airport, pilot_designation) values ('Lev', 'S1', 'licensed')$$, 'Licensed profile needs no certificates or ratings');
select throws_ok($$update public.profiles set pilot_designation = 'student' where user_id = auth.uid()$$, '23514', null, 'Owner cannot change to a student profile');
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);
with changed as (update public.profiles set bio = 'Admin override' where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' returning user_id)
select is((select count(*)::integer from changed), 0, 'Admin session has no cross-owner edit override');
reset role;

-- Disable a previously active owner without changing their JWT.
update public.memberships set status = 'disabled', disabled_at = now(), disabled_reason = 'Test disabled owner'
  where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","user_metadata":{"role":"admin","status":"active"}}', true);
select is((select count(*)::integer from public.profiles), 0, 'Disabling owner revokes reads with existing JWT');
with changed as (update public.profiles set bio = 'Disabled write' where user_id = auth.uid() returning user_id)
select is((select count(*)::integer from changed), 0, 'Disabling owner revokes writes with existing JWT');
select throws_ok($$insert into public.profiles (display_name, home_airport, pilot_designation) values ('Disabled', 'KPAO', 'licensed')$$, '42501', null, 'Disabled owner cannot create profile');
select set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated","user_metadata":{"role":"admin","status":"active"}}', true);
select is((select count(*)::integer from public.profiles), 0, 'Auth identity without membership cannot read profiles');
select throws_ok($$insert into public.profiles (display_name, home_airport, pilot_designation) values ('Unadmitted', 'KPAO', 'licensed')$$, '42501', null, 'Unadmitted account cannot create profile');
reset role;

select is((select display_name from public.profiles where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'Admin Pilot', 'Unauthorized edits left other profile unchanged');
select * from finish();
rollback;
