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
absent memberships. The disposable config enables the email/password provider
for those Admin-created users while global self-signup remains disabled. No email
is sent. The checked-in developer and hosted Auth configuration is unchanged. Only the
controller receives the local service-role key; the compiled Next fixture gets
the local API and publishable key. All writes and effects belong to disposable resources.

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
503 without destroying a potentially valid session.

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
Separate sessions prevent
destructive refresh/logout probes from contaminating other cases. Bodies,
non-cookie headers, browser assets and captured logs are scanned for credential
canaries; intentional Set-Cookie transport stays in memory.

Implementation-time local evidence: controller/cookie tests and the anonymous
compiled fixture passed on this Mac. Real services require CI because Docker is
unavailable here; only an exact-head successful integration job establishes the
real matrix. Consult the PR checks and sanitized summary for current results.

## Remaining feature work

- [VOLO-21](https://outsidethecockpit.atlassian.net/browse/VOLO-21): invitation-gated session establishment and admission.
- [VOLO-22](https://outsidethecockpit.atlassian.net/browse/VOLO-22): login/logout UI, supported Router Cache invalidation and fresh session-change navigation.
- [VOLO-23](https://outsidethecockpit.atlassian.net/browse/VOLO-23): recovery and configured mail delivery.
- [VOLO-107](https://outsidethecockpit.atlassian.net/browse/VOLO-107): exact `/auth/confirm` activation and redirect evidence when consumers exist; see [callback contract](auth-callbacks.md).
- [VOLO-110](https://outsidethecockpit.atlassian.net/browse/VOLO-110): hosted authenticated verification and explicit release evidence.
- [VOLO-120](https://outsidethecockpit.atlassian.net/browse/VOLO-120): deferred Netlify Age/non-storage reporting.

Deploy Previews share production Supabase; there is no staging environment.
Production publishing stays locked. A merge is not a release and local fixture
evidence does not close downstream feature tickets. VOLO-119 is Done only after
the user merges and merge ancestry is verified.
