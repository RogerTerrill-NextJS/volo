# Invitation schema and persistence interfaces

VOLO-127 under VOLO-27. Status: draft for written-spec review.

## Purpose and approved decisions

Translate the [approved account activation contract](2026-10-07-volo-121-invitation-contract-design.md)
into persistence that VOLO-28/29/30 and VOLO-122/124 can consume. Roger approved
two tables: invitations and send attempts; one live invitation per normalized
email; separate setup authorization; no membership at issuance; and restricted
deletion of referenced Auth users consistent with existing memberships.

Application invitations never expire with age. Only redemption, revocation or
supersession ends eligibility. Provider tokens and setup authorizations remain
finite. MVP invitation senders are active admins; member invitations are future
work. Sender authority never determines the recipient's role: activation grants
member only and must not overwrite or re-enable an existing membership.

This is a schema/interface design, not a migration or a working signup flow.
No hosted database/Auth changes, accounts, email or production publication occur.
Use feature/ branches, local/disposable write tests, and Netlify Deploy Previews
plus production only; previews share production Supabase. No staging environment.

## Alternatives and table boundaries

Use `public.invitations` for current eligibility and activation evidence, and
`public.invitation_send_attempts` for individual provider operations and their
outcomes. A single table would overwrite send history; an event-sourced model
would add reconstruction machinery unnecessary for the MVP.

Both tables are trusted-server-only: RLS enabled, no grants/policies for `anon`
or `authenticated`, including browser sessions belonging to admins. Grant only
required server operations to `service_role`; provider keys never enter browser
code. Service-role bypass is not user authorization: VOLO-29 must independently
verify current active admin membership before requesting a send.

No public security-definer helper, automatic signup trigger, membership trigger,
Realtime publication or public invitation listing is added. Future admin/member
UI reads go through a separately authorized server boundary with minimal output.

## Invitation fields

Names and types below are the proposed migration contract. UUIDs default to
`gen_random_uuid()` where generated; timestamps use `timestamptz` and database
time. Required fields are NOT NULL unless explicitly described as nullable.

| Field | Type / default | Meaning |
| --- | --- | --- |
| `id` | uuid primary key | Stable application invitation identity |
| `recipient_email` | text | Trimmed, immutable intended address |
| `recipient_email_key` | generated text | Canonical key derived from recipient_email; callers cannot select a different key |
| `invited_by_user_id` | uuid FK auth.users, RESTRICT | Original server-verified inviter; immutable |
| `status` | invitation_status, default pending_issuance | pending_issuance, issued, setup_verified, password_established, redeemed, revoked, superseded |
| `version` | bigint, default 1 | Positive generation fencing sends, verification and setup |
| `auth_user_id` | nullable uuid FK auth.users, RESTRICT | Provider subject reconciled at issuance; never rebound to another subject |
| `verified_user_id` | nullable uuid FK auth.users, RESTRICT | Recipient subject verified for the current setup generation |
| `verified_at` | nullable timestamptz | Server-observed invitation verification time |
| `setup_authorization_id` | nullable uuid | Correlation to VOLO-122's separate setup authority, not a credential or standalone grant |
| `password_established_at` | nullable timestamptz | Server-observed password success for that setup authorization/version |
| `created_at` | timestamptz, default now() | Creation time; never an eligibility deadline |
| `updated_at` | timestamptz, default now() | Last trusted state mutation |
| `redeemed_at` | nullable timestamptz | Successful atomic membership/redemption time |
| `revoked_at` | nullable timestamptz | Explicit administrative revocation time |
| `revoked_by_user_id` | nullable uuid FK auth.users, RESTRICT | Server-verified revoker |
| `revocation_reason` | nullable text | Bounded internal reason; never raw provider error/input |
| `superseded_at` | nullable timestamptz | Replaced by a new application invitation |
| `superseded_by_id` | nullable uuid FK invitations, RESTRICT | Replacement invitation, distinct from this row |

There is no invitation `expires_at`, time-based index predicate, expiry job, role
column, raw provider token, password or session credential. The setup UUID is an
internal identifier; knowing it does not authorize a request. VOLO-122 will add
its authority table and any validated foreign key in its own migration. Until
then no flow can treat a populated setup UUID as verified setup authority.

## Email matching and uniqueness

For MVP input, use ASCII email addresses, trim surrounding whitespace, and fold
ASCII A-Z to a-z using deterministic C-collation rules for the canonical key.
Keep the trimmed spelling for delivery. Preserve every dot and plus suffix;
do not apply mailbox-provider aliases, Unicode normalization or domain-specific
equivalence. Reject unsupported/non-ASCII addresses explicitly rather than
silently rewriting them. The server validates address syntax/length before
provider calls; the database enforces nonempty trimmed ASCII input, at most
254 bytes, and the generated normalization key. This is a deliberately bounded
input policy, not a claim that all possible email addresses are ASCII.

VOLO-29/125 must verify case/whitespace/dot/plus behavior with the pinned real
provider before activation. If provider matching disagrees, stop issuance and
revise this reviewed contract; do not silently merge identities or widen the
unique key. Every verified current email is canonicalized by the same function
and compared to the invitation key before setup/completion.

Use unique partial indexes on `recipient_email_key`, and on non-null
`auth_user_id`, for live states: pending_issuance, issued, setup_verified and
password_established. Terminal rows retain history. No index depends on now().
Concurrent creates for one email produce one live row; the losing request gets
`conflict`, with no provider side effect. Retrying an already-issued invitation
uses resend rather than a new identity. Terminal status does not permit account
replacement: the server still rejects existing accounts/memberships as specified
by VOLO-121, even when a database uniqueness constraint permits a new row.

## Structural integrity and transition ownership

VOLO-128 implements row-local checks with explicit null handling (a SQL CHECK
evaluating to NULL is insufficient). Enforce:

- version > 0; updated_at >= created_at; all present lifecycle timestamps >=
  created_at; no self-supersession; bounded nonempty revocation reason.
- issued and all later setup/redemption states require auth_user_id.
- Setup evidence is either wholly absent or includes verified_user_id,
  verified_at and setup_authorization_id; verified_user_id equals auth_user_id.
- setup_verified requires complete setup evidence and no password timestamp;
  password_established/redeemed require complete evidence and a password
  timestamp at or after verified_at. Other live states have no setup evidence.
- redeemed has redeemed_at at/after password_established_at, with no revocation
  or supersession fields. Only redeemed has redeemed_at.
- revoked requires revoked_at, revoked_by_user_id and reason; only revoked has
  those fields. superseded requires superseded_at and superseded_by_id; only
  superseded has those fields. Revoked/superseded rows may retain prior setup
  evidence for audit, but it grants no authority.

Checks describe valid snapshots, not proof of historical transitions or verified
Auth. Trusted mutation interfaces enforce immutability, previous state, expected
version, provider outcome and session evidence. VOLO-130 tests constraints without
claiming they prevent a privileged service from fabricating a history.

| Operation / owner | Permitted persistence change |
| --- | --- |
| Create / VOLO-29 | New pending_issuance row, version 1; no membership |
| Issue/reconcile / VOLO-29 | Bind an absent Auth subject once; pending_issuance → issued only after provider identity/outcome is reconciled |
| Resend / VOLO-29 | Eligible live row → pending_issuance at version+1; retain bound Auth subject, clear setup/password snapshot, invalidate old setup authority |
| Verify / VOLO-122 | issued → setup_verified for same current subject/version; bind new server-owned setup authorization |
| Reverify / VOLO-122 | Replace an expired/lost setup context only after renewed provider verification; a general login is insufficient |
| Password / VOLO-124 | setup_verified → password_established after server-observed password success for that current setup authorization |
| Redeem / VOLO-30 | password_established → redeemed atomically with member membership creation |
| Revoke / future admin lifecycle boundary | Live → revoked, version+1 and invalidate setup; currently record contract only, no admin revoke UI in VOLO-27 |
| Supersede / future admin lifecycle boundary | Live → superseded plus replacement creation in one transaction; old setup invalidated |

Terminal invitations are never reopened. Already-completed identical redemption
returns an idempotent result without changing password/member status again.
Loss of setup authority follows VOLO-121's admin resend process; reverify does
not mean replaying a consumed link. Recipient identity and original inviter are
immutable. A new recipient requires explicit supersession, not an email edit.

## Send attempt fields and provider concurrency

| Field | Type / default | Meaning |
| --- | --- | --- |
| `id` | uuid primary key | Server-generated operation/idempotency identifier |
| `invitation_id` | uuid FK invitations, RESTRICT | Parent invitation |
| `invitation_version` | bigint | Generation captured before the provider call |
| `requested_by_user_id` | uuid FK auth.users, RESTRICT | Verified active admin requesting this operation, separate from original inviter |
| `kind` | invitation_send_kind | initial or resend |
| `outcome` | invitation_send_outcome, default started | started, accepted, rejected or unknown |
| `started_at` | timestamptz, default now() | Durable reservation before external side effect |
| `completed_at` | nullable timestamptz | First observed provider outcome time, including timeout/unknown |
| `provider_error_code` | nullable text | Allowlisted sanitized category; never raw SDK response |
| `reconciled_outcome` | nullable invitation_send_resolution | accepted or rejected after investigation of started/unknown |
| `reconciled_at` | nullable timestamptz | Resolution time |

Unique `(invitation_id, invitation_version)` allows one send per generation.
Foreign keys cover referenced identities, while version matching is a locked
transaction precondition: do not FK a historical attempt to the parent's mutable
current version. Required timestamps/outcome pairs, positive version and bounded
allowlisted error categories are row-local checks. Reconciliation fields are
either both null or both present; original first outcomes are not overwritten.
An accepted send means the provider accepted the operation, not email delivery.

Reserve the generation and attempt in a short database transaction, commit, then
call the provider. Never hold a transaction open across network/email operations.
A repeated operation ID with identical inputs returns existing outcome; different
inputs with the same ID conflict. A started/unknown unresolved operation blocks
another send for that invitation until reconciled. No automatic takeover after
a timeout: a worker may still be completing the external side effect.

Finalize using the captured invitation/version/attempt IDs. A late result after
revocation/supersession may update that historical attempt's safe outcome but
cannot bind/rebind identity, restore eligibility or overwrite current setup.
Uncertain outcomes remain denied and admin-visible until VOLO-29 reconciles them;
never retry by blindly creating another Auth identity. Resend uses the same bound
subject and invalidates prior setup attempts. Actual provider renewal after an
already-consumed invite must be established through disposable Auth evidence.

## Persistence interface contract

These are semantic interfaces for downstream server-only modules/transactions,
not new publicly callable RPCs or implementations in this task. Authenticated
identity, current issuer role, verified email and setup/session proofs come from
trusted server checks, never request form fields. SQL implementations of
multi-row operations must be transactional; separate REST writes are insufficient.

| Operation | Inputs | Result / ownership |
| --- | --- | --- |
| reserveInvitationSend | operationId, recipientEmail or invitationId, expectedVersion for resend, verifiedRequesterId | invitationId, version, attemptId, boundSubject or conflict/denied/pending_reconciliation; VOLO-29 |
| recordInvitationSendOutcome | attemptId, capturedVersion, safeOutcome, reconciledSubject | recorded/stale/conflict; VOLO-29; never advance a terminal row |
| readInvitationEligibility | invitationId, expectedVersion, verifiedSubject, verifiedEmail | eligible/not_eligible/unavailable; VOLO-28; age is never a predicate |
| recordVerifiedSetup | invitationId, expectedVersion, verifiedSubject/email, setupAuthorizationId | setup_verified/conflict/denied; VOLO-122 after provider/session validation |
| recordPasswordEstablished | invitationId, expectedVersion, setupAuthorizationId, verifiedSubject, server-observed success | password_established/idempotent/conflict/denied; VOLO-124 |
| redeemInvitation | invitationId, expectedVersion, setupAuthorizationId, verifiedSubject | redeemed/already_redeemed/conflict/denied; VOLO-30 with membership transaction |

Service failures remain distinct from denial. Return minimal results and no
provider/session secrets. getAccess() remains the downstream app access gate.
VOLO-30 checks current setup authority and invitation under lock, then inserts
member membership and records redemption together. It must never upsert over an
existing active/disabled membership. A same-subject already_redeemed outcome
requires verified completion context and reports success only; it does not alter
current membership or establish a new setup/password grant.

## Setup authority, audit retention and deletion

The invitation stores the current verified/password snapshot for atomic activation;
the send table stores provider-attempt history. It is not a full history of every
setup/password transition. VOLO-122 owns separate expiring session-bound setup
authority and encrypted confirmation transport, including storage, lifetime,
cleanup, CSRF binding and server key management. VOLO-128 does not add these
secret stores or a fake setup-authority implementation. Any later FK/persistence
extension is a reviewed migration with matching rollback/cleanup ordering.

All Auth user FKs use ON DELETE RESTRICT, matching memberships. Parent invitation
and supersession references also restrict deletion, so deleting an invitation
does not silently erase history. Use explicit trusted maintenance ordering for
local fixtures: remove related setup/transport and send attempts, clear/remove
supersession links in the same owned fixture set, then invitations, memberships
and Auth users. Never apply this cleanup to hosted data as a test shortcut.

This restrict policy is provisional until account deletion/retention work in
VOLO-91 resolves erasure and audit retention. That feature must explicitly handle
inviter/recipient/revoker references; do not silently cascade-delete accounts or
claim permanent PII retention has been approved. Invitation age is never a reason
to garbage-collect a live invitation. Keep send errors sanitized and minimal.

## Migration and verification handoff

- VOLO-128 creates the two tables, enums, row checks, indexes and FKs in a new
  migration on the project's PostgreSQL 17 baseline; do not rewrite old migrations.
- VOLO-129 implements and tests explicit privileges/RLS. All client roles,
  including application admins and disabled members, have no direct table access.
- VOLO-130 verifies clean rebuild and upgrade, row constraints, live-email/subject
  uniqueness, independent send history, revoked/superseded/redeemed denial,
  old-invitation eligibility, role isolation and restricted deletion. Insertion
  and verification state must never create membership. Test invalid null pairs.
- VOLO-131 regenerates public-schema types with pinned local tooling and documents
  the exact interfaces and server-only privilege boundary. No manual type edits.
- VOLO-29/122/124/30/125 prove real provider normalization/resend, trusted subject
  binding, session/password evidence, concurrent provider operations and atomic
  membership/redemption. Database-only fixture users are not real Auth sessions.

VOLO-127 completion requires written design review and verified merge, not runtime
claims. Hosted migration/release and callback configuration remain separately
authorized downstream work.

## References

- [Approved invitation activation contract](2026-10-07-volo-121-invitation-contract-design.md)
- [Existing membership migration](../../../supabase/migrations/20261006040000_create_memberships.sql)
- [PostgreSQL 17 constraints](https://www.postgresql.org/docs/17/ddl-constraints.html)
- [PostgreSQL 17 partial indexes](https://www.postgresql.org/docs/17/indexes-partial.html)
