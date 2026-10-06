-- VOLO-17: identity is owned by Auth; application admission and roles are server-owned.
-- Retain membership on user deletion until account-retention rules are agreed (VOLO-13).
create type public.member_role as enum ('member', 'admin');
create type public.membership_status as enum ('active', 'disabled');

create table public.memberships (
  user_id uuid primary key references auth.users (id) on delete restrict,
  role public.member_role not null default 'member',
  status public.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_reason text,
  constraint memberships_disabled_state check (
    (status = 'active' and disabled_at is null and disabled_reason is null)
    or (status = 'disabled' and disabled_at is not null
        and nullif(btrim(disabled_reason), '') is not null)
  )
);

alter table public.memberships enable row level security;

-- Explicit grants also work on projects with permissive default privileges.
revoke all on table public.memberships from public, anon, authenticated;
grant select on table public.memberships to authenticated;
grant select, insert, update, delete on table public.memberships to service_role;

create policy memberships_read_own
  on public.memberships for select to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.memberships is
  'Server-owned application access. No membership means no admission. Never authorize from user_metadata.';
-- No automatic admission trigger, client write policy, public admin RPC, Storage bucket,
-- or Realtime publication. Feature migrations add those with their own access policies.
