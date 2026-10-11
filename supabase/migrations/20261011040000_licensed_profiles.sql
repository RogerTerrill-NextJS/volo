-- VOLO-236: licensed pilots only; do not relabel existing student profiles.
do $$
begin
  if exists (select 1 from public.profiles where pilot_designation = 'student') then
    raise exception 'Licensed-only migration blocked: existing student profiles require an explicit handling decision';
  end if;
end;
$$;

alter table public.profiles
  add constraint profiles_licensed_pilot check (pilot_designation = 'licensed');
