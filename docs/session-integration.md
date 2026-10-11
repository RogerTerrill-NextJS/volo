# Session integration and auth handoff

VOLO-119 adds an opt-in real Supabase Auth/PostgREST suite around the merged
session foundation. No test endpoint, login flow or privileged client is deployed.

## Run and ownership

Use Node 24, `npm ci` and a running Docker engine:

```sh
npm run test:auth:integration
```

The controller creates a unique temporary Supabase project and ports, copies
checked-in migrations, disables seeds and sets only that stack's JWT lifetime
to 120 seconds. It starts Auth/API/database through pinned CLI 2.119.0, discovers
local keys privately and refuses destinations outside the owned loopback API.
No root `.env.local`, hosted credentials or existing developer database is used.
Docker absence fails explicitly; the command never falls back to simulated Auth.

The controller provisions confirmed `example.invalid` accounts through local
Auth Admin with random passwords, then creates active A/B/admin, disabled and
absent memberships. VOLO-147 aligns checked-in local configuration with this
policy: email/password authentication enabled, global public signup and anonymous
sign-in disabled, and SMS/unused providers disabled. The CLI's
`auth.email.enable_signup` enables the email provider; global
`auth.enable_signup = false` still blocks public account creation. The disposable
stack inherits these admission settings unchanged so integration catches drift.
Foundation scenarios create accounts without email. VOLO-148/149 additionally
send email into the owned local SMTP capture; hosted settings are unchanged. The
controller receives the local service-role key. The compiled Next fixture gets
the local API/public key and a local modern server secret for guarded invitation
operations; this secret is excluded from client output and leak-scanned. All writes and effects belong to disposable resources.

Cleanup deletes memberships before Auth users, stops only the generated project
and removes owned files. SIGINT/SIGTERM and CI's `always()` cleanup cover normal
failure/cancellation. A forced process/runner kill can interrupt cleanup; retry
on the same Docker host using the ownership-only state:

```sh
node scripts/verify-auth-integration.mjs --cleanup
```

No global Docker prune, `stop --all`, remote reset or production linking occurs.
The ignored summary contains commit/version/scenario results and, on setup failure,
a sanitized fixture build diagnostic or an operation/status category. CLI status,
cookies, raw SDK/child errors, keys and passwords are not uploaded. A sanitized
fixture build diagnostic is also kept in the ignored evidence directory.

## Foundation interfaces

| Boundary | Current contract |
| --- | --- |
| Browser/server clients | Fresh clients; public configuration only; no session in shared module state. |
| Proxy | Real `getUser()` verification; persists rotated cookie chunks and forwards them to the current request; does not grant membership. |
| Read-only server client | Cannot silently establish an unpersisted refreshed session. |
| Writable server client | Cookie writes require a response-header sink and common private response policy. |
| `getAccess()` | Verifies user with Auth, reads current own membership under RLS, requires active status. |
| `requireRole(allowedRoles)` | Current membership and an explicit role allowlist. |
| `getPageAccess()` | Signed out → fixed `/login?reason=authentication-required`; membership denial/unavailability stays generic. |
| Mutation wrappers | Build-pinned origin, fresh identity/membership, role, input and resource permission before one effect. |
| Private response helper | Browser/CDN/Netlify no-store; Next controls Action browser headers. |

JSON mutation failures map unauthenticated to 401; origin/membership/role/resource
denial to 403; unavailable to 503; input to 400/413/415; unsupported method to
405; internal failure to 500. Actions return semantic result codes through Next's
transport rather than promising an HTTP 403. Recognized bad credentials clear
only the current project's session cookies. Auth outages/deadlines return safe
503 without destroying a potentially valid session. Legacy Auth error payloads
with a numeric HTTP `code` use their string `error_code` for the same recognized
credential decisions; unknown error codes remain unavailable.

Current membership changes take effect on new guarded requests even with an
existing JWT. This is distinct from session revocation. The termination scenario
records retained unexpired credentials against real `getClaims`, `getUser`,
refresh and application access separately. Revoked refresh must fail. The guard
requires current verified identity plus membership; it does not promise immediate
invalidation of every already-issued access JWT. Application behavior must agree
with actual Auth user verification, otherwise the scenario fails for investigation.
Do not turn an unexpected result into a passing baseline or change authorization
semantics without a scoped decision.

## Evidence matrix

| Evidence | Command / owner | What it establishes |
| --- | --- | --- |
| Controller and cookie safety | `npm test` | Destination/ownership/environment guards, cleanup ordering, redaction and independent jars; no Docker required. |
| Real service integration | `npm run test:auth:integration` / dedicated CI | Real issuance, admission/roles, membership changes, HTTP RLS, malformed credentials, refresh persistence, logout probes, A/B isolation, origins and local no-store/public controls. |
| Invitation-only admission foundation / VOLO-147 | Same real service integration job | Auth reports global signup disabled and only email provider enabled; direct public email/anonymous/OAuth requests fail without identity/session issuance. Real editable metadata and fresh sessions cannot admit missing/disabled memberships or promote a member. |
| Deterministic failure injection | `test:clients`, `test:proxy`, `test:access`, `test:protected-app`, `test:mutations`, `test:cache` | Real Next/SDK with simulated Auth/PostgREST: outages, deadlines, malformed responses, cookie writes and recovery. |
| SQL permissions and rebuild | Existing database CI / `npm run db:test` | Migration/pgTAP RLS and grants; seeds are not usable Auth sessions. |
| Browser history and Router Cache | Dated observations in [private caching](private-caching.md) / VOLO-22 | Delivered content may survive Back; refresh reauthorizes. Browser session-change behavior remains downstream. |
| Hosted anonymous navigation | Exact PR Deploy Preview | Runtime/public routes and signed-out protected routing only; no hosted writes. |
| Hosted authenticated/release | VOLO-110 | Requires separately approved bounded account/recipient and feature flows. |
| Netlify shared storage/Age | VOLO-120 | Deferred investigation; local no-store and a miss do not establish edge non-storage. |

The real suite uses one compiled fixture and independent SSR cookie jars. It
waits on actual issued expiration, never edits a valid JWT's expiry, with a
180-second maximum wait and 240-second scenario bound. Concurrent requests use
snapshots of the same expired session alongside independent B traffic; immutable
account IDs are checked both on refresh and on requests using returned cookies.
The unusable-refresh case retains credentials from a separately signed-out real
session; it tests server rejection rather than malformed token syntax.
Separate sessions prevent
destructive refresh/logout probes from contaminating other cases. Bodies,
non-cookie headers, browser assets and captured logs are scanned for credential
canaries; intentional Set-Cookie transport stays in memory.

Historical VOLO-119 evidence used CI while Docker was unavailable on this Mac.
For VOLO-125, Docker was available: all 30 real Auth scenarios passed locally,
and exact-commit CI also passed. Consult the [VOLO-125 evidence](volo-125-verification.md)
and [VOLO-126 readiness record](preview-verification.md#volo-126-account-signup-handoff)
for commit/job links and the separate hosted evidence limits.

## Remaining feature work

VOLO-125 extended this same stack and compiled app for the invitation
matrix, including successful invited activation, provider/setup expiry, wrong
identity/version, resend/replay and atomic redemption. VOLO-147 proves admission
configuration and identity/metadata isolation only; it does not prove those
flows by itself or deploy settings to the shared hosted project.

The approved [invitation activation contract](superpowers/specs/2026-10-07-volo-121-invitation-contract-design.md)
coordinates VOLO-21's implementation subtasks with invitation persistence,
admission, issuance and redemption under VOLO-27/28/29/30. Invitations are
email-specific and have no application expiry; provider links/setup sessions
remain time-limited. Issuance is admin-only for the MVP, with member invitations
reserved for future work. Invitation confirmation, password setup and local
schema/admission/redemption are implemented. Hosted callback activation remains
VOLO-107; local implementation does not close its hosted verification gate.

- [VOLO-21](https://outsidethecockpit.atlassian.net/browse/VOLO-21): invitation-gated session establishment and admission.
- [VOLO-22](https://outsidethecockpit.atlassian.net/browse/VOLO-22): VOLO-154/155 supply native login and current-browser logout; broader navigation remains VOLO-25.
- [VOLO-23](https://outsidethecockpit.atlassian.net/browse/VOLO-23): VOLO-156 supplies recovery requests and local mail; confirmation/password change remain VOLO-157 and hosted mail verification remains VOLO-107/110.
- [VOLO-107](https://outsidethecockpit.atlassian.net/browse/VOLO-107): exact `/auth/confirm` activation and redirect evidence when consumers exist; see [callback contract](auth-callbacks.md).
- [VOLO-110](https://outsidethecockpit.atlassian.net/browse/VOLO-110): hosted authenticated verification and explicit release evidence.
- [VOLO-120](https://outsidethecockpit.atlassian.net/browse/VOLO-120): deferred Netlify Age/non-storage reporting.

Deploy Previews share production Supabase; there is no staging environment.
Production publishing stays locked. A merge is not a release and local fixture
evidence does not close downstream feature tickets. VOLO-119 is Done only after
the user merges and merge ancestry is verified.

## Durable invitation issuance coverage

VOLO-148 extends this same disposable stack and compiled fixture with guarded
initial issuance, real create/bind/invite ownership, protected existing accounts,
concurrent normalized-email reservations and captured SMTP mail. The app origin
and callback are exact owned loopback destinations. The modern local server
secret enters only the fixture's server environment and credential-leak scans.
Mail token hashes stay in memory and are never emitted in summary artifacts.
Owner-scoped teardown removes invitation dependencies before referenced users.
There is no additional stack or CI job and no hosted write test.

## Invitation renewal coverage

VOLO-149 extends the same stack with guarded same-subject renewal, real captured
invite and recovery tokens, version-bound single-use proof, concurrent renewal,
and ambiguous-send inspection/reconciliation. Owned SQL snapshots assert recovery
sending leaves password hash, confirmation, ban and role unchanged without
exporting those values. The temporary snapshot table is disposable test data,
client-inaccessible and removed during teardown. Proof rows are deleted before
attempts. Tokens, sessions and raw resume secrets stay in memory and leak scans.

Initial issuance uses invite transport. Confirmed invitation subjects use recovery
transport only with a matching single-use resend proof; ordinary recovery remains
separate. VOLO-122 composes proof consumption and setup creation in
one transaction, and VOLO-123 supplies the public setup page. Lost original
provider evidence cannot be reconstructed from account state or timestamps.

## Signup lifecycle and bypass coverage (VOLO-125)

The existing real-service job covers confirmation, native password completion,
membership redemption and a fresh protected request. It rejects borrowed setup
cookies across subjects/sessions, changed recipient emails, terminal/stale grants,
ordinary recovery without proof and direct public signup. Concurrency proves one
provider password update and one redeemed member; duplicates do not update the
password again. Owned timestamp fixtures prove provider/setup expiry independently
of invitation age. Existing SQL tests establish transaction and permission behavior.

No second harness or handoff rerun is required. The implemented interfaces and
safe retry outcomes are in [auth callbacks](auth-callbacks.md#implemented-account-setup-handoff-volo-123124125).
Hosted browser/email/allowlist and authenticated CDN acceptance remain pending
under VOLO-107/110; anonymous preview smoke cannot establish them.

## Native login coverage (VOLO-154)

The same real Auth job now exercises the production login page and POST handler:
real password sign-in cookies, fresh member/admin admission, missing/disabled
membership denial, generic invalid credentials, origin/input rejection before Auth,
and safe malformed/outage responses without automatic password retries. Login
does not create membership or invitation setup authority. Native 303 navigation
performs a fresh dashboard request; hosted browser acceptance and logout remain
with their existing owners. Membership/role cookie-stability scenarios acquire
fresh sessions immediately before their assertions so the separate two-minute
expiry fixture cannot introduce refresh into a membership-only comparison.

Local validation passed all 31 real Auth scenarios, 46 core/smoke tests, focused
login/input/Proxy tests, protected-app and private-cache fixtures, server/browser
boundary checks, type checking, lint and a production webpack build. Chrome
verification confirmed error focus and empty password fields. Independent review
reported no actionable findings. CI, Deploy Preview acceptance and production
release verification remain pending; logout is VOLO-155.

## Current-browser logout coverage (VOLO-155)

The existing real Auth fixture now tests the production native logout handler:
origin/query/method rejects occur before provider access or cookie changes; local
scope revokes current refresh authority while retaining independent sessions.
Anonymous and denied-membership sessions can sign out. Provider failure does not
retry and still clears browser authority with safe feedback. Malformed sessions,
stale auth/verifier chunks and setup cookies are cleared; unrelated cookies remain.
Existing refresh, natural-expiry and retained-JWT scenarios remain authoritative
for their separate guarantees. Logout does not promise instant JWT invalidation.

Local validation on October 10, 2026 passed all 32 real Auth scenarios, 46 core
tests, focused Proxy/protected-page and private-cache checks, client/server
boundaries, type checking, lint and a production webpack build. Chrome Back and
reload checks used the existing cache fixture with the production AppShell; see
[local browser evidence](private-caching.md#logout-navigation-evidence-volo-155).
Independent review's verifier-cookie cleanup finding was corrected and verified.
Two earlier local runs failed existing invitation uncertainty assertions; the
full rerun passed. Added sanitized failure diagnostics, with every assertion
retained; the intermittent cause remains unconfirmed. CI, Deploy Preview and
production release verification are separate and remain pending.

## Forgotten-password request coverage (VOLO-156)

The existing real Auth fixture tests the production request page and native
handler. Origin/query/input/method denials occur before Auth; known, unknown and
disabled-member recipients share fixed feedback. Requests preserve the visitor's
independent session and create no cookies. Injected outage, rate-limit and
malformed responses have the same acknowledgment and exactly one provider call.
Dedicated disposable recipients keep recovery mail separate from invitation
assertions. Captured local mail has the exact owned callback, ordinary recovery
marker and real provider token evidence, without invitation renewal proof.
Ordinary application confirmation fails closed pending VOLO-157.

Local validation on October 10, 2026 passed all 33 real Auth scenarios with owned
stack cleanup, 46 core tests, 9 focused Proxy/recovery-input tests, and all 8
access unit tests. Private-cache and client/server boundary checks, type checking,
lint and the production webpack build passed. Review found no implementation
blocker; the recovery-input tests were added to the existing CI access command.

Chrome verified the labeled form, acknowledgment focus, and empty email field
after reload using the existing local cache fixture. Chrome blocked its native
POST with `ERR_BLOCKED_BY_CLIENT`; browser submission is not established by that
check. HTTP submission and actual local SMTP delivery are covered by the real
Auth suite. Hosted email, Deploy Preview acceptance and production release
verification remain separate.
