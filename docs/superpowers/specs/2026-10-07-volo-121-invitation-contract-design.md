# Invitation-only account activation contract

VOLO-121, under VOLO-21. Status: draft for written-spec review.

## Intent and scope

An invited pilot accepts an invitation sent to their specific email address,
establishes a password, and gains access only when server-owned membership is
activated. Roger approved this flow and email-specific invitations. Sending is
admin-only for the MVP. Members inviting other people is explicitly future work.

This task defines contracts for VOLO-122 through VOLO-126 and coordinates the
invitation tickets; it implements no routes, schema, email delivery or hosted
configuration. Production publishing stays locked. Use feature/ branches,
Deploy Previews and production only, with no staging environment. Previews share
production Supabase; write tests use owned disposable local resources.

## Mechanism and alternatives

Use Supabase email-bound invitations for Auth token issuance and verification,
plus a server-owned application invitation record for eligibility, expiry,
revocation, activation and auditing. The Auth token and app record are separate:
successful Auth verification alone never grants app membership.

Custom bearer codes would require another token issuance/verification lifecycle
and are unnecessary for email-specific invitations. Shareable codes are excluded.
Supabase invitation APIs are the proposed provider mechanism; local real-service
tests must establish exact SDK/provider behavior before production activation.

Keep public self-signup, anonymous signup and unused providers disabled. The
password provider required for invited-user password login must remain usable;
do not confuse enabling that provider with allowing public registration. Test
direct provider signup bypass, not only the absence of a signup screen.

## Identity, authority and invitation records

VOLO-27 owns schema and migrations. Its record must support:

- A stable invitation ID, intended email, server-derived inviter user ID, created
  time, expiry, lifecycle state and send-attempt outcome.
- The Auth user ID associated with issuance, verified recipient user ID, setup
  attempt/version, password-step evidence and final redemption time.
- Revocation and supersession information sufficient to reject older attempts.

Never store a reusable raw invitation token, password or session in this record.
Email matching trims surrounding whitespace and uses the agreed provider-compatible
case normalization, without removing dots or plus suffixes. Provider equivalence
must be tested; do not merge identities merely because addresses look similar.
Bind completion to the verified Auth subject and server-owned invitation record,
checking the verified current email against the intended recipient. User-supplied
IDs, query parameters and user_metadata are not authority.

MVP invitations grant only member membership. Admin promotion is a separate
server-authorized operation. Existing active/disabled memberships must not be
overwritten or re-enabled by accepting an invitation. A duplicate invitation to
an existing account requires an explicit admin-visible outcome, not automatic
account replacement, password reset, identity linking or role changes.

VOLO-29 checks current active admin membership before issuance. Store who invited
the recipient independently of the recipient's membership role. Future member
invitations can extend this issuer policy, with separate decisions on limits,
abuse controls and revocation, while retaining the same activation contract.
Do not add a permissive member policy, quota subsystem or member invite UI now.

## Lifecycle and failure recovery

| State | Meaning | App access |
| --- | --- | --- |
| Pending issuance | App record exists; Auth creation/send outcome not yet reconciled | Denied |
| Issued | Provider identity is bound; invitation is live; accepted send is not confirmed delivery | Denied |
| Setup verified | Explicit acceptance verified the invite; short-lived setup authorization is bound to this user and invitation version | Denied |
| Password established | Server-observed successful password operation recorded for that setup attempt | Denied |
| Redeemed | One database transaction activated member membership and recorded redemption | Allowed subject to fresh normal guards |
| Expired/revoked/superseded | Invitation or setup authorization is no longer valid | Denied |

The application invitation expires 24 hours after issuance. Provider token expiry
may be shorter; the earliest applicable deadline wins. Verified setup authorization
expires after 30 minutes and never later than the invitation. These are proposed
MVP policy defaults, included in this spec's review, not claims about current
hosted settings. A resend supersedes earlier application setup attempts and
requires renewed verification; validate provider resend behavior locally.

VOLO-30 owns one-time redemption. Finalization locks/checks the invitation/version
and atomically creates the member membership and redemption record in Postgres.
Concurrent identical completions return the same safe outcome. Other subjects,
expired/revoked attempts or conflicting existing memberships are rejected.

Auth issuance, email delivery, cookie delivery and password changes cannot share
that database transaction. Record their outcomes separately and reconcile partial
failure; never label the whole workflow atomic. A send timeout does not justify
blindly creating another Auth identity. An admin retry first reconciles the bound
identity and provider outcome. Do not delete a possibly legitimate account as
compensation. VOLO-29 owns the resend/reconciliation interface.

If password update succeeds but recording its success fails, retain denial and
allow the same still-authorized setup attempt to repeat the password operation.
Do not infer success from editable metadata or a client's success claim. If the
result is ambiguous or the setup authorization is lost/expired, require renewed
invitation verification through the admin resend process. A consumed email link
cannot establish a new setup context by replay. A retry after database completion
must not repeat password mutation or re-enable a disabled membership.

Existing getAccess/current membership checks remain the final access authority.
No membership is created at issuance or at link verification. Pending setup lives
in invitation state; do not overload disabled membership to mean onboarding.

## Routes, setup authorization and input boundaries

The email points to the reviewed origin's exact /auth/confirm destination. GET and
HEAD must not call verifyOtp, redeem an invitation, establish a new authenticated
session or change a password. A GET may create only short-lived confirmation
transport/CSRF state; it must not consume the invitation. Show an explicit Accept
invitation action and perform verification in an origin-checked POST.

The callback may use a Route Handler returning the confirmation response, with
the interactive UI at a separate route; Next does not allow page.tsx and route.ts
at the same URL. Do not add third-party assets, analytics or prefetches to token
handling responses. Use private/no-store and Referrer-Policy: no-referrer. Never
echo a token into HTML/RSC or redirect it to the setup page. Initial email-link
URLs inevitably contain verification material: configure ingress/platform logging
redaction or exclusion and verify it before hosted activation. Never claim the
application alone can remove a provider's existing request logs.

VOLO-122 must transfer the token into expiring server-side confirmation state
behind an opaque Secure/HttpOnly/SameSite cookie, then redirect to a clean URL.
Store only a hash of the opaque lookup key. Any retained provider verification
material is encrypted at rest with a server-only key, short-lived, access-restricted
and deleted after use/expiry; key provisioning and rotation belong to the later
implementation's reviewed server configuration contract;
do not serialize it into client output. Limit creation attempts and retention to
avoid unbounded storage from anonymous GET traffic. Local HTTP uses the explicit
development cookie exception; hosted cookies require HTTPS. The confirmation
POST binds the CSRF value to this transport context and verifies type=invite.

After verification, persist standard Auth cookies through the existing writable
client/header sink and establish separate server-owned setup authorization bound
to the verified subject, Auth session and invitation version. General Auth login,
recovery sessions and user_metadata flags cannot substitute for that authorization.
Session binding must be checked using verified claims/provider evidence; a parsed
unverified JWT is not proof. VOLO-122's real-service tests establish the binding.

Redirect to fixed /account/setup. Password setup and completion use a POST contract
owned by VOLO-123/124. Require fresh verified identity, unexpired matching setup
authorization, current invitation eligibility, strict input limits and the exact
build-configured origin. Reject missing/cross-origin Origin and conflicting
cross-site fetch metadata. CSRF binding supplements origin validation. Do not
derive trusted origins from Host/forwarded-host, accept arbitrary next URLs or
weaken existing active-member mutation wrappers to admit setup requests.

Responses containing tokens, setup/session cookies or password results, including
failures, apply applyPrivateResponseHeaders before cookie writes. Never silently
establish an unpersisted refreshed session. Use fixed generic failure destinations
and semantic errors without exposing whether a different email has an account.
After redemption, clear setup authorization and perform fresh navigation to
/dashboard with token/query propagation suppressed. Reauthorize normally there.

Recovery uses the same callback entry but an explicitly separate type=recovery
branch owned by VOLO-23. It cannot create invitation setup authorization or redeem
an invitation. Missing/unsupported types fail closed. Existing users use recovery,
not a new invitation that silently replaces credentials.

## Ownership and implementation order

| Owner | Deliverable |
| --- | --- |
| VOLO-121 | Reviewed contract and cross-ticket interfaces |
| VOLO-27 | Invitation persistence, constraints, RLS and migration tests |
| VOLO-28 | Eligibility enforcement and direct signup/provider bypass rejection |
| VOLO-29 | Admin-only issuance, email delivery outcome, reconciliation and resend |
| VOLO-30 | Atomic membership/redemption transaction and replay protection |
| VOLO-122 | Confirmation transport, explicit verification, cookies and setup authorization |
| VOLO-123 | Accessible password setup UI and safe validation/retry presentation |
| VOLO-124 | Password-step orchestration and activation using VOLO-30's transaction |
| VOLO-125 | Disposable real Auth integration, concurrency and bypass evidence |
| VOLO-126 | Account-setup docs and exact-preview readiness handoff |
| VOLO-22/23 | Login/logout and recovery respectively |
| VOLO-107/110/25 | Hosted allowlists, deployed verification and cross-feature testing |

After contract approval, agree schema/admission/redemption interfaces before
building consumers. Mocked interfaces may support development, but completion
requires real implementations and tests. Invitation creation can use controlled
local fixtures until the admin send UI exists. No circular assumption that
VOLO-107 must be fully complete before local callback implementation: local
consumers come first, then reviewed hosted callback activation and tests.

## Verification and completion

VOLO-121 is a documentation milestone: review this spec for a coherent lifecycle,
fixed trust boundaries, ownership and unresolved assumptions. No production code
or runtime success is claimed here. Later tasks must prove:

- Real email-bound issuance/verification, password setup and persisted cookies;
  no app admission until membership and redemption commit together.
- Invalid/expired/revoked/superseded/replayed tokens, wrong identity/type/session,
  GET/HEAD/prefetch safety and lost-cookie/ambiguous-provider outcomes.
- Concurrent submissions, database rollback, password-step retries, resend,
  existing/disabled accounts and server-owned roles.
- Direct public Auth signup/anonymous/unused-provider rejection, CSRF/origin/input
  handling, A/B session isolation and credential/log/cache controls.
- Exact local deadlines and provider behavior under pinned real Auth tooling;
  safe redacted summaries, cleanup, typecheck/lint/build and SQL/boundary checks.

Hosted tests require the exact reviewed Deploy Preview, approved bounded accounts
and recipients, and destination-specific callback approval. No hosted changes or
email sends are authorized by this contract. Production release is separate;
Netlify Age/non-storage investigation remains end-of-project VOLO-120.

## Sources

- [Existing callback contract](../../auth-callbacks.md)
- [Session foundation and handoff](../../session-integration.md)
- [Supabase invitation API](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail)
- [Supabase email templates, scanner behavior and server verification](https://supabase.com/docs/guides/auth/auth-email-templates)
- Installed Next.js Route Handlers and cookies guides were read before this design;
  implementation tasks must recheck the relevant installed guides before coding.
