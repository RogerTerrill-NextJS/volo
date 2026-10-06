-- Fictional database fixtures only, for local/disposable staging resets.
-- These are not usable login accounts: no passwords or auth.identities are created.
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated',
   'admin@example.invalid', now(), '{}', '{}', now(), now()),
  ('22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated',
   'member@example.invalid', now(), '{}', '{}', now(), now()),
  ('33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated',
   'disabled@example.invalid', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.memberships (user_id, role, status, disabled_at, disabled_reason)
values
  ('11111111-1111-4111-8111-111111111111', 'admin', 'active', null, null),
  ('22222222-2222-4222-8222-222222222222', 'member', 'active', null, null),
  ('33333333-3333-4333-8333-333333333333', 'member', 'disabled', now(), 'Fictional test fixture')
on conflict (user_id) do nothing;
