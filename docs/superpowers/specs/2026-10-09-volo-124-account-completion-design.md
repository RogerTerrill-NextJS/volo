# VOLO-124 account completion

## Intent and scope

Complete invitation-only activation by connecting the existing verified setup
authority, caller-session password update, atomic redemption and fresh membership
guard. No access is granted until redemption commits. No password, Auth token,
raw setup cookie or browser success assertion is stored as evidence.

Reuse VOLO-122 and VOLO-152/153. VOLO-123 owns the accessible setup UI, VOLO-125
the broader signup integration matrix, and VOLO-126 the operational handoff.
Use feature/ branches and the current checkout. Production publishing stays
locked; disposable CI owns write tests. Hosted migration and release remain
separate approved operations, and merging does not establish production readiness.

## Approach

Use one POST Route Handler at `/account/complete`, a small server-only completion
function, and methods on the existing confirmation store. This gives the writable
Supabase client an explicit private response/header sink and lets VOLO-123 submit
a native form. A Server Action is an alternative but complicates explicit response
header ownership. A separate activation service or provider queue would duplicate
existing lifecycle ownership and is unnecessary for this scope.

The route accepts only `password`, `passwordConfirmation` and `csrf`, with bounded
URL-encoded input, duplicate/unknown field rejection, and a request-body deadline.
Match passwords without trimming or normalization; enforce the existing minimum
of eight characters and a 256-byte maximum. Provider password validation remains
authoritative. No client email, subject, role, invitation/version or destination is
accepted. Validate the exact configured Origin and fetch metadata before Auth or
database work; reject query parameters and unsupported methods without mutation.

Add a server-only helper for VOLO-123 to obtain a domain-separated SHA-256 CSRF
value from the current opaque setup cookie. Compare that value on POST; the raw
cookie and its database lookup digest are never rendered. This supplements the
existing Origin check without adding another cookie or secret-key configuration.

## Password reservation and evidence

Add only a password-operation UUID and its start timestamp to the existing
`invitation_setup_authorizations` row. Keep its original expiry unchanged. A
service-role-only begin operation binds the cookie digest, verified subject/email,
session and origin, then locks invitation before authority and rechecks version,
state, current Auth/session eligibility and absence of conflicting membership.
Return minimal server context and either permission to perform the password step,
existing password evidence, historical redemption, or a safe rejection/busy result.
Generate operation IDs on the server. A competing request never calls Auth while
another operation owns the reservation. A reservation is not membership or proof
of password success; it is never automatically reclaimed for a second password
mutation. An abandoned/uncertain reservation requires renewed invitation
verification through the existing admin resend flow.

A restricted record operation checks the exact reservation and complete current
authority again, then records `password_established` and its server timestamp.
Matching repeats are idempotent. A restricted release operation may clear only
that matching reservation while password evidence remains absent. Only the
trusted server calls release after a definitive provider rejection, a confirmed
failure before sending the password request, or failure to record a password
success that this same request actually observed. If release cannot be confirmed,
deny completion and require renewal; never blindly replay an ambiguous mutation.

This retains the approved recovery rule: an observed password success followed by
failed evidence recording can permit the same authorized setup attempt to repeat
the password step after safe reservation release. A lost/ambiguous response cannot
be promoted to success. SQL transactions end before all Auth/network operations.

## Completion flow and outcomes

1. Validate input, Origin and CSRF; verify fresh claims and provider user through
   the existing caller-session client with cookie/header persistence enabled.
2. Begin completion against the setup cookie and verified identity. Derive all
   invitation identifiers/version from trusted state. Existing password evidence
   or historical redemption skips the password mutation entirely.
3. For a fresh reservation, call `auth.updateUser({password})` on that session with
   a bounded, no-store transport and no automatic mutation retry. Require a
   successful, matching provider user response; reverify session identity before
   recording evidence. Uncertain provider or persistence results grant no access.
4. Call the existing `redeem` method with current bound completion context.
   Denied/conflicting/unavailable results never produce a success destination.
5. On redemption or historical completion, call fresh `getAccess()` and require
   an authorized matching subject. Never treat historical redemption as current
   admission or re-enable an existing disabled membership.
6. Clear the browser setup cookie on verified completion and issue a fixed 303 to
   `/dashboard`. Retain the restricted database completion context until its
   original expiry, as VOLO-152 requires for simultaneous/response-loss retries.
   Normal destination guards reauthorize access.

Failures use fixed `/account/setup?result=<recognized-code>` redirects suitable
for the future native UI: invalid input, password rejected, retry later, renew
invitation, or access denied. No submitted values, provider detail or arbitrary
next URL is propagated. Apply existing private response headers and no-referrer
before cookie writes, including failures. A completed transaction with failed
fresh access remains denied and does not repeat the password change.

Resend/expiry can invalidate setup during the external Auth operation. Evidence
recording and redemption recheck current authority afterward; they must reject
the old context. This does not claim that application revocation can undo a
password change already accepted by the independent provider.

## Verification and review

Use TDD for the new orchestration and restricted persistence operations. Reuse the
existing input/origin/private-cache/session helpers and disposable CI harness.
Test reservation overlap, stale authority, exact-operation fencing, no premature
membership, definitive password failure, ambiguous provider response, evidence
record/release failure, redemption response loss, historical retry without another
password call, and disabled membership preservation. Extend real local Auth
scenarios only for the new route/password/evidence boundary; reuse the existing
SQL redemption and race suites rather than copy them.

Generate exact database types and update existing upgrade expectations. Require
full current-commit CI and one independent final review. Review particularly the
provider error classification, cookie persistence, concurrent reservation/release
ordering, stale setup during Auth work, completion after response loss, and the
distinction between historical completion and current access. Preview and
production verification remain separate records.
