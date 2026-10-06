begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(14);

-- Tests own their fixtures and work even when the database was reset without seeds.
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'test-admin@example.invalid'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'test-member@example.invalid'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'test-disabled@example.invalid'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'test-unadmitted@example.invalid');
insert into public.memberships (user_id, role, status, disabled_at, disabled_reason) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin', 'active', null, null),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'member', 'active', null, null),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'member', 'disabled', now(), 'Test fixture');

select ok((select relrowsecurity from pg_class where oid = 'public.memberships'::regclass), 'RLS enabled');

set local role anon;
select throws_ok('select * from public.memberships', '42501', null, 'Anonymous reads denied');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","user_metadata":{"role":"admin"}}', true);
select is((select count(*)::integer from public.memberships), 1, 'Member sees only own row');
select is((select role::text from public.memberships), 'member', 'User metadata cannot promote member');
select throws_ok($$update public.memberships set role = 'admin'$$, '42501', null, 'Member cannot promote self');
select throws_ok($$insert into public.memberships (user_id, role) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'admin')$$, '42501', null, 'Member cannot admit an account');
select throws_ok('delete from public.memberships', '42501', null, 'Member cannot delete membership');

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);
select is((select count(*)::integer from public.memberships), 1, 'Admin browser client also sees only own row');
select throws_ok($$update public.memberships set role = 'admin'$$, '42501', null, 'Admin client cannot write directly');

select set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}', true);
select is((select status::text from public.memberships), 'disabled', 'Disabled user can see own access status');
select throws_ok($$update public.memberships set status = 'active', disabled_at = null, disabled_reason = null$$, '42501', null, 'Disabled user cannot reactivate self');

select set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}', true);
select is((select count(*)::integer from public.memberships), 0, 'Auth account alone grants no membership');
reset role;

select throws_ok($$update public.memberships set status = 'disabled' where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$, '23514', null, 'Disabling requires timestamp and reason');
set local role service_role;
select lives_ok($$update public.memberships set status = 'disabled', disabled_at = now(), disabled_reason = 'Test' where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$, 'Trusted service can disable membership');
reset role;

select * from finish();
rollback;
