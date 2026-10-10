# Deploy Preview routing verification

Current checks updated for VOLO-154; historical VOLO-109 evidence is below.
Pre-release checks use Netlify Deploy Previews;
VOLO has no separate staging environment.

## Repeatable HTTP checks

Run the production smoke suite against the preview linked from the pull request:

```sh
SMOKE_BASE_URL=https://deploy-preview-<PR-number>--voloapp.netlify.app npm test
```

This mode requires Node.js and the checked-out test file, starts no local server,
and does not require a local build or application credentials. Without
`SMOKE_BASE_URL`, the suite continues to start the local production server after
`npm run build`. Use only a URL origin, without credentials, a path, or a query.
The suite makes GET, HEAD, OPTIONS, and an unsupported POST to the health endpoint;
it does not access Supabase or write application data.

| Check | Expected result |
| --- | --- |
| `GET /` | 200, HTML with dashboard navigation |
| `GET /login` | 200, native email/password form and home link; private/no-store |
| Anonymous `GET /dashboard` | Redirect to fixed `/login?reason=authentication-required`, no incoming query forwarded; no Workspace overview; private/no-store |
| Repeated anonymous `GET /dashboard?verification=volo-109` | Same safe login destination without forwarded query or workspace content |
| Anonymous dashboard RSC | Canonical `_rsc` negotiation followed by login redirect; no workspace content; no-store |
| `GET /api/health` | 200, JSON `{"status":"ok"}` |
| `HEAD /api/health` | 200, JSON content type and empty body |
| `OPTIONS /api/health` | 204, Allow includes GET, HEAD, OPTIONS |
| `POST /api/health` | 405; unsupported method does not render the homepage |
| Unknown `/dashboard/volo-109-missing` and `/api/volo-109-missing` | 404; no homepage fallback |

Dashboard denial is checked without executing browser JavaScript; redirects can
be HTTP redirects or the framework's streamed/RSC protocol. The dashboard is
dynamic and checks verified identity/current membership on each server request.
The homepage is public/static; the public login form is dynamic/private.
`/api/health` is the dynamic Route Handler served by the OpenNext server function.
There is currently no valid multi-level UI page below `/dashboard`; the nested
API path and unknown deeper UI paths cover the routes available today. Add valid
deeper page cases when those pages are implemented.

## Browser checks

1. Open the preview's `/dashboard?verification=volo-116` anonymously. Confirm
   `/login`, the email/password form, and no workspace overview.
2. Reload. Confirm `/login` remains usable with no redirect loop.
3. Follow Back to home, then Open dashboard. Confirm navigation reaches login.
4. Use browser Back and Forward. Confirm the URL and visible page agree.
5. Check browser console errors and save the login-state screenshot.

Use `npm run test:protected-app` for authenticated/denied/outage/navigation cases
against fictional local services. Do not create hosted users or write membership
data for preview smoke tests. Previously delivered browser content cannot be
retracted by server checks; refresh/new server requests enforce current access.

Repeated HTTP requests do not substitute for these browser checks.

## Mutation verification

VOLO-117 ships reusable server-only guards, not a product mutation endpoint.
Run `npm run test:mutations` locally/CI for actual Next API and fetched/native
Server Action fixtures. They use fictional Auth/membership and record effects
independently, proving denied calls perform zero writes. Never deploy those fixture
routes or use hosted accounts/data to extend smoke coverage. Required CI verifies
the compiled origin configuration/default build and database policies; the current
preview can only prove that existing public/protected navigation remains intact.
The first actual mutation feature owns hosted authenticated integration checks.

## Recorded results

The [PR #6 preview](https://deploy-preview-6--voloapp.netlify.app/),
[immutable deploy](https://6ac59f6b7f12f80007345df7--voloapp.netlify.app/),
at commit `6cec73a`, passed all seven smoke tests on October 6, 2026.
Direct dashboard navigation with a query, browser reload, both application links,
and Back/Forward passed in Chrome. No console errors or warnings were captured
during those interactions. No deployment-specific routing failures were found.

These checks do not cover sessions, invitation/reset callbacks, private caching,
or database access. Those remain under VOLO-110 and VOLO-19.

## Private cache verification

Use `SMOKE_BASE_URL=https://deploy-preview-<PR-number>--voloapp.netlify.app node scripts/verify-preview-cache.mjs`
for repeated anonymous GET/HEAD policy, cache-status and age observations. See the
[cache evidence and limits](private-caching.md), including actual local browser
history observations. No hosted authenticated isolation claim is made; VOLO-110
owns that verification after downstream auth flows exist.

## VOLO-122 invitation confirmation

PR #32 adds `/auth/confirm`; the password/setup UI remains VOLO-123. Public
preview checks may use clean GET or HEAD without cookies or query parameters.
Do not submit hosted email tokens or acceptance forms as smoke checks: previews
share production Supabase, and hosted activation is a separate approval.

On October 9, 2026, the PR #32 preview's clean HEAD returned HTTP 200 with browser
private no-store, both CDN no-store policies, no-referrer, restrictive CSP and no
Set-Cookie. This establishes the deployed public response boundary only.

Implementation commit `ccf75da` passed all three jobs in
[CI run 37967437831](https://github.com/RogerTerrill-NextJS/volo/actions/runs/37967437831):
application typecheck/lint/default build/full tests and compiled boundaries;
seeded/unseeded SQL, upgrade preservation, exact schema types, real acceptance
and renewal transaction overlap, cleanup correlation races and scheduled idle
cleanup; and disposable real Auth/mail acceptance/session/expiry/leak scenarios.
The final PR commit must retain green checks before merge.

Disposable Auth tests submit the actual initial invite, resend invite and
proof-bearing recovery form, then revalidate the persisted session and setup
reader on a fresh request. They cover two-tab CSRF, replay, stale initial links,
ordinary recovery without proof, wrong verified subject, no membership, and a
store failure after real provider verification that clears new Auth/setup cookies.
Compiled tests also prove GET/HEAD/prefetch cannot refresh expired Auth cookies.

The local default Turbopack build could not bind its worker port in this execution
environment. The local webpack production build and 44 core tests passed; the
required default Turbopack build passed in CI. These results do not prove hosted
key provisioning, ingress token-log exclusion, Auth template settings or actual
hosted cleanup executions. Those activation prerequisites are documented in
[environment configuration](environment-configuration.md).

The single independent branch review found no blocking correctness or security
issues. Deferred minor: a consumed/uncertain confirmation can display temporary
retry wording; opening a current email or asking an admin to renew remains the
recovery path. No authorization is delivered on that failure.

Execution decisions: use pinned Node and disposable CI because local npm/Docker
were unavailable; advance independent crypto/input work during SQL CI (possible
adapter revision); split the bounded parser into one separate module (one extra
file); recover exact generated public types from temporary CI output when ZIP
download stalled (temporary log volume, then removed); preserve generator
whitespace for exact type comparison (formatting only); use local webpack after
Turbopack worker-port restrictions while retaining default CI build (Mac-specific
Turbopack behavior verified only in CI); and validate immutable exact-commit CI
results for Docker-dependent task completion (no independent Mac DB/Auth rerun).
Hosted ingress-log exclusion, key/template/allowlist/migration/cron health and
production publication remain separate activation/release gates. Setup UI,
password/membership activation and ordinary recovery stay with downstream
owners. The executor checked this documentation against observed evidence;
functional review covered the immutable implementation range.

## VOLO-126 account signup handoff

On October 10, 2026, the reviewed [PR #37](https://github.com/RogerTerrill-NextJS/volo/pull/37)
passed all three application/database/real-Auth CI jobs at
`6a4296ea0d3fb5e2a8d932837c1239b7082262af` and merged into `main` as
`f7b63e272c43a5aeb33c07efe659cd23890569fa`. The implemented signup interfaces,
fixed destinations and failure/retry behavior are in
[auth callbacks](auth-callbacks.md#implemented-account-setup-handoff-volo-123124125).
The approved activation/persistence contracts remain authoritative.

| Evidence | Exact result and limit |
| --- | --- |
| [Application CI](https://github.com/RogerTerrill-NextJS/volo/actions/runs/38072616412/job/114272990214) | Passed typecheck, lint, default build, tests and compiled boundaries. |
| [Database CI](https://github.com/RogerTerrill-NextJS/volo/actions/runs/38072616412/job/114272990120) | Passed rebuild/access-policy job; local/disposable database evidence. |
| [Real Auth CI](https://github.com/RogerTerrill-NextJS/volo/actions/runs/38072616412/job/114272990233) | Passed the existing disposable Auth integration job. Reuses VOLO-125's 30-scenario local evidence; no new handoff harness or full-suite rerun. |
| [Netlify deploy](https://app.netlify.com/projects/voloapp/deploys/6aca7844a11c5500083829e2) | Ready for the exact implementation commit above; [numbered preview](https://deploy-preview-37--voloapp.netlify.app). |
| Anonymous preview smoke | All eight existing HTTP tests passed once against that preview: public home/login, dashboard HTML/RSC denial, health methods and nested 404s. No Auth/app-data writes. |
| Hosted signup/browser acceptance | Pending; anonymous smoke does not prove email, token confirmation, password setup, authenticated cookies or membership activation on hosted services. |
| Production release | Pending explicit release request and separate production verification. Merge/preview success does not establish a production deployment. |

The smoke used `SMOKE_BASE_URL=https://deploy-preview-37--voloapp.netlify.app node --test tests/smoke.test.mjs`
from the merged implementation tree. It starts no server or deployment, uses no
credentials and sends only the existing public-route checks (including the health
endpoint's unsupported POST). The local VOLO-125 RSC check failed once before a
strict unchanged rerun passed; its cause remains unconfirmed and is retained in
the [verification note](volo-125-verification.md).

### Hosted checklist handed to VOLO-110

1. Select a current reviewed PR revision and verify its exact deploy/commit.
   PR #37 supplies historical evidence; it is closed. VOLO-107 owns the exact
   `/auth/confirm` entry and valid/invalid redirect evidence. No wildcard entries.
2. Before enabling email links, verify hosted migrations/restricted RPC grants,
   confirmation runtime keys, cleanup scheduling and successful executions,
   server-pinned origin, Auth admission settings, templates/SMTP and ingress
   exclusion of `token_hash`/`resume`. These prerequisites remain unverified by
   this handoff; use the [existing configuration gate](environment-configuration.md#invitation-confirmation-keys-and-cleanup-volo-122).
3. Obtain the separately approved hosted account, recipient, exact destination
   and bounded writes. Then check invite → explicit acceptance → password setup
   → fresh member access, safe expired/reused/invalid denial, renewal and cookie/
   cache behavior. Record sanitized outcomes and deploy IDs, never credentials.
4. Track login/logout/Router Cache under VOLO-22, ordinary recovery/mail under
   VOLO-23, and deferred Netlify storage/Age investigation under VOLO-120. Keep
   those tickets open until their own acceptance evidence exists.
5. Keep production publishing locked. Publish only an explicitly requested batch,
   verify the production callback/release separately, and retire preview allowlist
   entries when review closes. Previews share production Supabase; there is no
   staging environment or isolated hosted write-test backend.

VOLO-126 changes documentation only. It does not modify hosted settings, send
emails, write accounts/data, add a deployment or mark dependent tickets complete.
