# Fenced invitation resend and explicit reconciliation

VOLO-149, step 2 of VOLO-29. Status: written spec approved by Roger.
Roger approved the approach, the invitation-specific recovery transport amendment,
and this written specification in conversation.

## Intent and scope

An active admin can renew setup for the same recipient and bound Auth account
without creating another account, granting membership or extending old setup
authority. Invitations never expire by age. Provider email tokens still have
finite lifetimes. Acceptance means accepted for sending, not delivery.

Extend the existing invitation service, mutation policies, transactional SQL
functions and real local Auth/mail harness. Preserve the original inviter and
record the admin requesting each resend separately. Admin UI belongs to VOLO-31;
HTTP confirmation, session cookies and setup authorization belong to VOLO-122;
password changes and membership redemption remain their existing later tickets.
This work supplies the proof persistence/consumption contract those consumers need,
but does not implement a public confirmation route or change a password.

The [activation contract](2026-10-07-volo-121-invitation-contract-design.md),
[persistence contract](2026-10-07-volo-127-invitation-schema-design.md) and
[issuance spec](2026-10-08-volo-148-invitation-issuance-design.md) remain authoritative
except for the explicit recovery-transport amendment below. Update their relevant
references together during implementation so VOLO-122 has one consistent contract.

Use `feature/` branches. No staging, hosted migrations, real email, hosted account
or Auth changes, or production publishing. Previews share production Supabase;
all write tests use owned disposable local/CI services. Keep production publishing
locked. Do not introduce queues, background workers, automatic retries, timed
takeover, an email delivery service or a second integration harness.

## Authorization and trusted inputs

Reuse the exact-origin mutation guard, fresh verified Auth identity and active
admin membership lookup. Accept only invitation ID and expected current version
for resend. Generate the operation ID and any email proof secret on the server.
Derive recipient, subject and callback from trusted records/configuration, never
requester-supplied email, role, subject, redirect or metadata.

Check current admin membership in the reservation transaction and immediately
before each privileged provider operation. Provider inspection failure is
unavailable; it is not permission. Reject any subject with membership, including
disabled membership, a ban, missing identity or a changed normalized email. Do
not reset credentials, unconfirm email, re-enable users or rebind the subject.
Use existing ASCII normalization; dots and plus suffixes remain significant.

## Resend transaction and execution

Extend the existing send reservation boundary with a resend form while keeping
initial issuance compatible. Lock invitation then attempts consistently. Serialize
operation-ID replays, and atomically:

1. Validate active admin, expected version, eligible live state and bound subject.
   Redeemed, revoked and superseded invitations are terminal. An absent subject
   requires explicit ownership reconciliation before resend; never discover and
   adopt a different account by email.
2. Require the preceding generation to have a known accepted/rejected outcome,
   or an explicit accepted/rejected reconciliation. An unresolved started/unknown
   attempt returns pending reconciliation regardless of elapsed time.
3. Increment version exactly once, set pending issuance, clear verified subject,
   verification time, setup authorization and password-established snapshots.
   Invalidate previous generation email proof in the same transaction. Future
   setup consumers must also check the invitation's current version; retaining
   a historical setup record never preserves its authority.
4. Insert one started resend attempt for the new generation and requesting admin.
   Return immutable recipient, bound subject, captured version and fresh marker.

Identical operation replay returns durable state without another provider call;
different input with the same operation ID conflicts. Concurrent resends for one
expected version have one winner. A rejected send retains the incremented version
and invalidation; failure never restores old setup authority.

Commit before external work. Inspect the exact bound Auth subject, choose the
transport from its verified confirmation state, recheck admin permission, and send
once. Inspect/validate identity again before recording acceptance, including for
recovery sends whose SDK success does not return a subject. Missing/mismatched
evidence is unknown rather than accepted. Preserve bounded fetch/body deadlines,
no redirects, no retries and lazy server-only credentials.

Extend outcome recording to initial and resend attempts without weakening initial
subject ownership checks. Resend must match its retained bound subject. Preserve
first observed outcome and separate reconciliation fields. Late results may finish
historical attempts but cannot change the current generation, setup evidence,
terminal eligibility or subject. SQL functions retain hardened search paths,
service-role-only execution, RLS and client denial. Regenerate types with the
pinned CLI; do not hand-edit generated declarations.

## Approved amendment: invitation-specific recovery transport

For an unconfirmed bound account, renew using the existing invite mechanism.
For a confirmed bound account that has not completed application activation, use
Supabase's recovery-email transport to send a dedicated resume-setup email. Sending
that email does not itself change a password. Never create a replacement account
or clear confirmation to make the invite endpoint accept the request.

Recovery transport alone must not authorize invitation setup. Generate a fresh
32-byte cryptographically random opaque secret for each resend, persist only its
SHA-256 digest against the exact attempt/invitation/version/subject, and include
the secret in the configured application callback carried by that email. Apply
this proof to both resend transports so their authority has the same generation
fence. Keep raw proof in process memory only; an operation replay cannot regenerate
or disclose it. At most one proof record exists per resend attempt.

Use a small server-owned proof table with attempt reference, secret digest,
transport enum (invite/recovery), and consumed timestamp. Subject and version come
from its attempt and invitation, avoiding independent editable copies. Revoke
client access and use a narrow transactional consumption function. Never store
provider tokens or raw resume secrets in this table. Clear/invalidate old proofs
under the same invitation lock when advancing a generation. Cleanup follows the
existing owned-stack deletion order, removing proof rows before attempts.

After inspecting confirmation state, commit the proof digest and selected transport
through a narrow service-only function before sending. Require the fresh attempt,
requesting active admin, unchanged current pending generation and exact bound
subject. Existing different proof/transport conflicts; it never permits another
send. A failure here performs no provider send and retains durable attempt state
for explicit reconciliation. Never put a secret into an email without its durable
proof record already committed.

The local templates link directly to the configured application `/auth/confirm`
with provider token hash, correct provider verification type and opaque resume
proof. Derive the callback origin/path from server configuration; caller input
cannot redirect it. Register all proof/token canaries for existing leak checks.
Keep provider tokens and proof secrets out of diagnostics and static assets.
Hosted URL-log exclusion and exact redirect/template provisioning remain a
separately reviewed enablement operation, as required by the activation contract.
Prove that the pinned local provider retains the callback query; do not silently
broaden hosted redirect allowlists to make a test pass.

VOLO-122 will capture both secrets into its protected short-lived confirmation
context and verify only on explicit POST, never GET/HEAD. For a resend, it must:

- Verify the provider token with the transport recorded for that attempt.
- Obtain a freshly verified matching subject/email and provider session evidence.
- Consume the matching opaque proof once under the current invitation lock,
  requiring the exact current issued generation and absence of membership.
- Atomically record version-bound setup authority with proof consumption. If
  setup creation fails, neither proof consumption nor setup recording commits.

Implement the proof validation/consumption primitive in this ticket; VOLO-122
composes it into its final setup transaction rather than performing an unrelated
REST write. Rechecking current version at password/redemption remains mandatory.
An ordinary login or recovery session, a client assertion of token type, an old
proof, another invitation's proof or proof without provider verification cannot
substitute for this combined evidence. Initial version-1 invite verification keeps
its existing contract; after a resend it is stale even if its provider token still
verifies. Consuming a proof never creates membership or changes credentials.

## Explicit reconciliation and its limits

Reconciliation is an authenticated server operation separate from resend. It
inspects the reserved subject and attempt; it does not send email, create accounts
or infer rejection from elapsed time. Binding an initially absent subject is
permitted only for the initial operation's reserved UUID with matching normalized
email and all existing account/membership restrictions. Identity existence proves
ownership only, not successful sending.

Resolve started/unknown to accepted or rejected only from trustworthy evidence
for that exact operation. A successful provider response still held by the
original server operation is such evidence; a definitive proven no-send rejection
is rejection evidence. A bare browser outcome, matching email, confirmed account,
invited-at timestamp, captured mail in production, or lack of a response is not
operation-specific proof. Do not expose a mutation accepting an admin's chosen
accepted/rejected value as authoritative evidence.

Provide an internal reconciliation boundary for those trusted observed results
and a guarded inspection operation that can safely report unresolved state. Record
the resolution/time separately without rewriting the original started/unknown
outcome. Repeating the identical resolution is harmless; conflicting resolution
fails. Prevent later outcome recording from contradicting an established
resolution or promoting a stale generation. Terminal invitations can retain
history but remain terminal.

Accepted reconciliation can advance pending issuance to issued only for the exact
current live generation with its verified bound subject. Rejected resolution does
not issue it. Inspection failure or conflicting evidence leaves the operation
unresolved. Reconciliation requires a current active admin; recording a late
historical result is not authorization to perform another privileged provider call.

The pinned SDK has no established operation-specific receipt lookup for a lost
invite/recovery response. Therefore a process crash that loses all trustworthy
outcome evidence can remain pending reconciliation. This ticket does not promise
that every ambiguous send can be automatically or manually declared safe to retry.
Do not invent a provider lookup or treat timestamps as receipts. A future operator
recovery capability needs its own evidence contract; no timeout-based override is
included here. This limitation must remain visible in the implementation docs and
safe result returned to the eventual admin UI.

## Verification and completion

Reuse the single real Auth/mail fixture and disposable stack. Local Docker is
unavailable on this workstation; existing CI supplies real provider/database
evidence before completion. Extend fixture routes only inside the disposable
compiled test application; add no public application test endpoints.

Meaningful checks cover:

- Signed-out/member/disabled or revoked admin, wrong origin, injected authority,
  mismatched subject/email, membership and ban denial before sending.
- Concurrent resend/version races and operation replay cause one version advance,
  one attempt and one provider send; stale generation/terminal results stay denied.
- Setup/password snapshots and prior proof are invalidated even if renewal fails;
  age alone never blocks renewal, and the same subject remains bound.
- Real unconfirmed renewal, then actual local token consumption and confirmed
  renewal: no duplicate account, password mutation, role change or membership;
  mail contains the exact callback, appropriate type and current opaque proof.
- Proof digest storage, single consumption, version/subject/transport mismatch,
  replay denial, terminal denial and ordinary recovery without proof denial.
- Lost response/record failure stays blocked; known trusted outcome reconciliation
  is idempotent, does not send, and cannot revive an old generation. Identity-only
  inspection and arbitrary admin-selected outcomes never resolve uncertainty.
- Case/whitespace normalization and meaningful dot/plus distinctions remain intact.
- pgTAP verifies transactional fences, grants, client denial and schema constraints;
  existing upgrade/type generation, lint/type/build and relevant local checks pass.
- Owned cleanup includes proof rows; credentials, sessions, token hashes and raw
  resume proofs are redacted and absent from browser static output.

Read the relevant installed Next.js guides before application changes. Keep tests
focused on these new risks rather than duplicating the entire activation suite.
Update the old contradictory local email paragraph while updating integration
documentation. A passing CI run and focused review are required before a PR is
ready; merging does not publish production or enable hosted mail/configuration.

## Provider design evidence

Supabase's [invite implementation](https://github.com/supabase/auth/blob/master/internal/api/invite.go)
rejects confirmed users. Its [recovery implementation](https://github.com/supabase/auth/blob/master/internal/api/recover.go)
provides recovery email transport; missing users can receive an indistinguishable
successful HTTP result, hence explicit subject verification. The
[recovery SDK reference](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)
and [email template reference](https://supabase.com/docs/guides/auth/auth-email-templates)
describe the callback/template mechanism. Upstream documentation/source motivates
the design; tests against the pinned disposable provider are the acceptance evidence.

## Execution clarification: template query shape

The fixed callback carries a non-authorizing `flow=invitation` query marker for
both initial issuance and resend; resend adds `resume`. Templates append provider
token/type fields with `&`, avoiding Go HTML-template conditional URL ambiguity
and SiteURL comparisons that would break separately approved preview origins.
Future ordinary recovery uses the same fixed-origin/path convention with its
own non-secret query marker. Flow values never grant invitation authority.
