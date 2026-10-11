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

-- Representative fictional profiles; no pilot credentials are verified by VOLO.
-- The invitation upgrade verifier also seeds the historical membership-only schema.
do $$
begin
  if to_regclass('public.profiles') is not null then
    insert into public.profiles (user_id, display_name, home_airport, pilot_designation,
                                certificates, ratings, aircraft_access, flying_interests, bio)
    values
      ('11111111-1111-4111-8111-111111111111', 'Fictional Licensed Pilot', 'KPAO', 'licensed',
       array['Private pilot'], array['Instrument'], 'Flying club C172', 'Local trips', 'Fictional local fixture'),
      ('22222222-2222-4222-8222-222222222222', 'Fictional Student Pilot', 'SQL', 'student',
       '{}', '{}', null, 'Training', null),
      ('33333333-3333-4333-8333-333333333333', 'Fictional Disabled Pilot', 'KSQL', 'licensed',
       array['Private pilot'], '{}', null, null, null)
    on conflict (user_id) do nothing;
  end if;
end;
$$;
