# Durable admin-only invitation issuance

VOLO-148, step 1 of VOLO-29. Status: written spec approved by Roger.

## Purpose and boundaries

Allow a currently active admin to issue an invitation to one specific email
address, with durable evidence of what was requested and what the provider
reported. A provider acceptance means the email was accepted for sending; it
does not prove delivery or admit the recipient to the application.

Follow the approved [activation contract](2026-10-07-volo-121-invitation-contract-design.md)
and [persistence contract](2026-10-07-volo-127-invitation-schema-design.md).
Recipients can become members only through later activation work. Invitations
do not expire with age. Issuance never inserts membership, confirms email,
promotes a role, resets a password or re-enables an existing account.

This ticket supplies a server-only issuance boundary and transactional database
functions. Admin UI belongs to VOLO-31; confirmation and password setup belong
to VOLO-122; atomic admission belongs to VOLO-30. VOLO-149 supplies resend and
explicit reconciliation. Do not add queues, automatic retries, background jobs,
an invitation listing API or another integration stack.

Use `feature/` branches. Tests write only to owned disposable local/CI services.
There is no staging environment. Deploy Previews share production Supabase and
are unsuitable for these write tests. This work does not change hosted Auth
configuration, deploy migrations to hosted databases, send real invitations or
publish production.

## Architecture and authorization

Expose one server-only issuance operation through the existing mutation policy
and guard. Its request accepts an email address; recipient role, requester ID,
provider subject and callback URL are never client-selected authority. Reuse
the existing exact-origin check, fresh Auth verification and current membership
lookup. Only an active admin reaches privileged configuration or provider calls.
Recheck current admin membership inside the reservation transaction and before
the external send. A membership lookup failure is unavailable, not permission.

Validate a trimmed ASCII email of at most 254 bytes using the existing contract:
ASCII case folding for comparisons, preserving dots and plus suffixes. Reject
unsupported input before provider writes. Never infer identity from editable
user metadata. Future VOLO-31 can reuse this boundary; this ticket needs no
deployed UI or public test endpoint.

Use the existing lazy privileged configuration and Supabase client conventions.
Do not introduce a PostgreSQL driver or another database credential. Privileged
keys remain server-only and are unnecessary for ordinary app builds. Calls have
bounded timeouts, no automatic retries and no redirects. Safe results distinguish
accepted, rejected, conflict, pending reconciliation and service unavailable;
raw provider payloads, errors and credentials never reach a browser or log.

## Durable reservation and provider identity ownership

Generate an operation UUID on the trusted server. For initial issuance, use that
same UUID as the explicitly requested new Auth user ID. This gives a durable
correlation even if the process dies after provider creation but before binding;
it is an identifier, not a credential. Only server-generated UUIDs enter this
path. An operation replay cannot create a second send.

Add service-role-only transactional functions in a new migration:

1. `reserveInvitationSend` validates the current admin, input and operation ID;
   rejects any existing Auth account for the normalized email or proposed subject;
   and atomically inserts a `pending_issuance` invitation at version 1 plus its
   `initial`/`started` attempt. Commit before calling Auth. Concurrent requests
   for the same normalized address have one winner. Repeated identical operation
   inputs return the existing reservation/outcome with an explicit replay marker;
   different inputs conflict. Only a fresh reservation permits external work.
2. An internal subject-binding function locks the invitation and attempt, checks
   the captured version, initial operation, current admin and live status, then
   verifies the newly created `auth.users` subject and normalized email. It
   rejects existing membership, subject mismatch or any rebind. Bind the subject
   and commit before sending. Binding alone leaves `pending_issuance` unchanged.
3. `recordInvitationSendOutcome` records a whitelisted first observed outcome
   and completion time for the captured attempt/version. Accepted can advance
   the matching pending generation to `issued` only with its bound subject.
   Rejected/unknown leave it pending. A late result can finish attempt history
   but cannot revive a terminal invitation, advance another version or rebind
   identity. Identical repeated outcomes are harmless; inconsistent outcomes
   conflict. Reconciliation fields remain untouched in this ticket.

Implement these as narrowly granted functions with hardened empty search paths,
fully qualified objects and execution revoked from PUBLIC, anon and authenticated.
Grant execution only to service_role. This does not create a browser-callable
security-definer helper. Keep existing table RLS and client denial intact.
Use a consistent invitation-then-attempt locking order; serialize operation-ID
reservation so concurrent repeats cannot both receive permission to call Auth.
Use database time. Keep provider calls outside transactions.

## Provider sequence and failure handling

Supabase's invite endpoint can reuse an existing unconfirmed user. Therefore,
checking for an account and then calling invite directly is insufficient.
Use Admin `createUser` first with the reserved UUID, intended email and
`email_confirm: false`, without supplied password or role/authority metadata.
The provider may generate an unknown random password internally; do not describe
this as proof of a user-established password. Creation must not send an email.
Confirm this behavior against the pinned real local Auth service.

Only a successful creation response with the exact reserved UUID and matching
email permits durable binding. Only a successful binding and fresh admin check
permit `inviteUserByEmail`. Verify its returned subject and email again before
recording accepted. Never invite an account merely discovered by email, even if
it is unconfirmed. A duplicate created between reservation and creation is a
safe conflict and must never receive an invite from this operation.

Classify only documented, proven no-send rejections as rejected, using existing
safe codes such as identity_conflict, provider_rejected or rate_limited.
Timeouts, transport failures, ambiguous server responses and unexpected identity
results are unknown. If creation succeeds but binding fails, do not send; retain
the reserved subject correlation for explicit reconciliation. Do not delete or
reset an account as automatic compensation. If the database cannot persist an
outcome, the durable attempt remains started and blocks another send.

An accepted send whose outcome cannot be committed must be reported as pending
reconciliation, never as an invitation safe to retry. Started and unknown
attempts remain blocked regardless of elapsed time. Replaying an operation
returns its durable state without calling createUser or invite again. A rejected
initial attempt also retains its reservation and owned subject, if any; subsequent
send decisions belong to VOLO-149 rather than a second issuance path.

Recording history after an admin loses access is allowed; that does not authorize
another provider call or override status/version fences. Revocation during an
external call cannot cancel an already accepted email, so the outcome remains
historical evidence and must not restore eligibility.

## Callback and email contract

Derive the exact `/auth/confirm` redirect from the pinned server application
origin, never from request headers or caller input. The invitation email must
link directly to the application with `token_hash` and `type=invite`; a default
provider verification GET link would consume the token before the application's
explicit acceptance flow. Add a checked-in local invite template using the
provider's RedirectTo and TokenHash template values and configure it for the
owned local harness. Do not change hosted templates or redirect allowlists.

This ticket verifies the captured mail link without consuming it. It does not
implement confirmation GET/POST, setup authorization or password completion.
VOLO-122 retains the contract that GET/HEAD cannot verify, redeem, establish a
session or change a password. Provider tokens remain finite even though the
application invitation has no age-based expiry.

## Focused verification in the existing harness

Extend the existing real Auth application fixture, disposable Supabase helper
and CI job. Use one stack and one compiled fixture. Supply the fixture with an
owned loopback application origin, exact local callback allowlist, checked-in
template and the modern server secret from the pinned local CLI. Preserve the
production secret validator; fail clearly if the pinned local runtime cannot
provide the required key. Never fall back to a hosted key or weaken validation.

Read captured mail only from that owned stack's local SMTP capture service.
Keep passwords, keys, token hashes and sessions in memory; register them for the
existing credential-leak checks and redact failure paths. Scan browser assets
for the added privileged key as well. Copy the template into the owned temporary
stack, and ensure cleanup removes owned invitation attempts/invitations before
referenced users, using local owner access rather than broadening service grants.
Do not use global Docker pruning or clean unrelated stacks.

Cover these distinct boundaries without duplicating the full future VOLO-125
activation matrix:

- Signed-out, member, disabled-admin and stale/revoked-admin requests cannot
  issue; wrong-origin requests fail before privileged work.
- A valid admin produces one invitation, one attempt and one owned unconfirmed
  Auth subject; captured mail has the exact application callback; no membership
  appears and acceptance does not claim delivery.
- Real-provider case/whitespace behavior agrees with normalization; plus and dot
  variants retain their identity meaning. Existing confirmed or unconfirmed
  accounts and disabled members are unchanged and receive no invite.
- Concurrent normalized-email requests and repeated operation IDs permit one
  provider send. Different inputs for an operation ID conflict.
- Binding/outcome reject mismatched subjects and stale generations; terminal
  records cannot become issued. Database/provider failure injection proves
  started/unknown durability and absence of retries or unsafe compensation.
- An old but otherwise live invitation has no application age-based deadline.
  This does not require consuming or renewing a provider token.
- pgTAP verifies function grants, client denial, transaction fences, idempotency
  and first-outcome preservation. Regenerate database types with the pinned CLI;
  do not hand-edit generated function declarations.

Use narrow deterministic unit tests for outcome classification and orchestration
failure paths, real Auth/mail for provider behavior, and existing database CI
for SQL behavior. Run the repository's relevant type, lint and build checks.
Docker is unavailable on this workstation, so real Auth/mail and database
evidence must come from the established CI jobs before declaring implementation
complete. No preview or production write test substitutes for that evidence.

## Implementation review criteria

The implementation is ready for review when admin-only issuance works through
the existing guard, short transactions surround external calls, account ownership
is established before sending, and failure paths cannot silently send twice.
The existing CI harness must prove provider behavior and database fences with
sanitized evidence. Hosted enablement, resend/reconciliation, confirmation UI
and member admission remain separate reviewed work.

Provider behavior motivating the creation step was checked against the
[Supabase Auth invite implementation](https://github.com/supabase/auth/blob/master/internal/api/invite.go)
and [Admin user creation implementation](https://github.com/supabase/auth/blob/master/internal/api/admin.go).
Upstream source is design evidence; the pinned local runtime tests are the
acceptance evidence.
