-- VOLO-128: snapshot integrity only. Trusted interfaces own transitions and Auth proof.
-- Keep creation and initial client denial atomic, including under permissive defaults.
begin;

create type public.invitation_status as enum
  ('pending_issuance', 'issued', 'setup_verified', 'password_established', 'redeemed', 'revoked', 'superseded');
create type public.invitation_send_kind as enum ('initial', 'resend');
create type public.invitation_send_outcome as enum ('started', 'accepted', 'rejected', 'unknown');
create type public.invitation_send_resolution as enum ('accepted', 'rejected');

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  recipient_email_key text collate "C" generated always as
    (translate(recipient_email collate "C", 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')) stored,
  invited_by_user_id uuid not null references auth.users (id) on delete restrict,
  status public.invitation_status not null default 'pending_issuance',
  version bigint not null default 1,
  auth_user_id uuid references auth.users (id) on delete restrict,
  verified_user_id uuid references auth.users (id) on delete restrict,
  verified_at timestamptz,
  setup_authorization_id uuid,
  password_established_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  redeemed_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id uuid references auth.users (id) on delete restrict,
  revocation_reason text,
  superseded_at timestamptz,
  superseded_by_id uuid references public.invitations (id) on delete restrict,
  constraint invitations_email_input check (
    octet_length(recipient_email) between 1 and 254
    and octet_length(recipient_email) = char_length(recipient_email)
    and recipient_email = btrim(recipient_email, ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13))
  ),
  constraint invitations_positive_version check (version > 0),
  constraint invitations_timestamps check (
    updated_at >= created_at
    and (verified_at is null or verified_at >= created_at)
    and (password_established_at is null or password_established_at >= created_at)
    and (redeemed_at is null or redeemed_at >= created_at)
    and (revoked_at is null or revoked_at >= created_at)
    and (superseded_at is null or superseded_at >= created_at)
  ),
  constraint invitations_issued_subject check (
    status not in ('issued', 'setup_verified', 'password_established', 'redeemed') or auth_user_id is not null
  ),
  constraint invitations_setup_evidence check (
    (verified_user_id is null and verified_at is null and setup_authorization_id is null)
    or (verified_user_id is not null and verified_at is not null and setup_authorization_id is not null
      and auth_user_id is not null and verified_user_id = auth_user_id)
  ),
  constraint invitations_setup_state check (
    (status in ('pending_issuance', 'issued') and verified_user_id is null and password_established_at is null)
    or (status = 'setup_verified' and verified_user_id is not null and password_established_at is null)
    or (status in ('password_established', 'redeemed') and verified_user_id is not null and password_established_at is not null)
    or status in ('revoked', 'superseded')
  ),
  constraint invitations_password_evidence check (
    password_established_at is null
    or (verified_at is not null and password_established_at >= verified_at)
  ),
  constraint invitations_redemption_state check (
    (status = 'redeemed' and redeemed_at is not null and password_established_at is not null
      and redeemed_at >= password_established_at)
    or (status <> 'redeemed' and redeemed_at is null)
  ),
  constraint invitations_revocation_state check (
    (status = 'revoked' and revoked_at is not null and revoked_by_user_id is not null
      and revocation_reason is not null and char_length(btrim(revocation_reason)) between 1 and 500
      and revocation_reason = btrim(revocation_reason))
    or (status <> 'revoked' and revoked_at is null and revoked_by_user_id is null and revocation_reason is null)
  ),
  constraint invitations_supersession_state check (
    (status = 'superseded' and superseded_at is not null and superseded_by_id is not null and superseded_by_id <> id)
    or (status <> 'superseded' and superseded_at is null and superseded_by_id is null)
  )
);

create unique index invitations_live_email_key on public.invitations (recipient_email_key)
  where status in ('pending_issuance', 'issued', 'setup_verified', 'password_established');
create unique index invitations_live_auth_subject on public.invitations (auth_user_id)
  where auth_user_id is not null and status in ('pending_issuance', 'issued', 'setup_verified', 'password_established');

create table public.invitation_send_attempts (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.invitations (id) on delete restrict,
  invitation_version bigint not null,
  requested_by_user_id uuid not null references auth.users (id) on delete restrict,
  kind public.invitation_send_kind not null,
  outcome public.invitation_send_outcome not null default 'started',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  provider_error_code text,
  reconciled_outcome public.invitation_send_resolution,
  reconciled_at timestamptz,
  constraint invitation_send_attempts_generation unique (invitation_id, invitation_version),
  constraint invitation_send_attempts_positive_version check (invitation_version > 0),
  constraint invitation_send_attempts_completion check (
    (outcome = 'started' and completed_at is null)
    or (outcome <> 'started' and completed_at is not null and completed_at >= started_at)
  ),
  constraint invitation_send_attempts_reconciliation check (
    (reconciled_outcome is null and reconciled_at is null)
    or (reconciled_outcome is not null and reconciled_at is not null
      and outcome in ('started', 'unknown') and reconciled_at >= coalesce(completed_at, started_at))
  ),
  constraint invitation_send_attempts_safe_error check (
    provider_error_code is null or provider_error_code in
      ('timeout', 'provider_rejected', 'rate_limited', 'provider_unavailable', 'identity_conflict', 'unknown')
  )
);

alter table public.invitations enable row level security;
alter table public.invitation_send_attempts enable row level security;
revoke all on table public.invitations, public.invitation_send_attempts from public, anon, authenticated, service_role;
grant select, insert, update on table public.invitations, public.invitation_send_attempts to service_role;
revoke all on type public.invitation_status, public.invitation_send_kind,
  public.invitation_send_outcome, public.invitation_send_resolution from public, anon, authenticated;
grant usage on type public.invitation_status, public.invitation_send_kind,
  public.invitation_send_outcome, public.invitation_send_resolution to service_role;

comment on table public.invitations is
  'Server-owned invitation snapshots. Age never expires eligibility. No membership or setup authority is granted by a row.';
comment on column public.invitations.setup_authorization_id is
  'Correlation only. VOLO-122 owns verified, expiring setup authority and its later FK migration.';
comment on column public.invitations.version is
  'Trusted mutations enforce expected-generation fencing, immutable recipient/inviter/subject and terminal-state denial.';
comment on table public.invitation_send_attempts is
  'Reserve before provider call; reconcile unresolved outcomes before another send. Accepted does not mean delivered. No provider secrets.';
-- No client policies, business RPC, transition trigger or Realtime publication.
-- Service-role bypass is not caller authorization. Owner-only explicit maintenance
-- must handle retained references; account erasure/retention remains VOLO-91.
commit;
