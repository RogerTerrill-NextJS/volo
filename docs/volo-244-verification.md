# VOLO-244 verification

Status: implementation committed and Vercel Preview ready. Administrator
workflow verification and production preparation/cutover remain pending.

## Source and destination

- Base: merged main `3e2a480f22311704fe1e2244eb6391037f6641de` (PR #124).
- Branch: `feature/volo-244-vercel-migration`; implementation `e79cdf9891bcae393c57311538f61aff9e445f8a`.
- Destination selected by user: [VOLO / volo](https://vercel.com/volo7/volo).
- Approved design: automatic previews, manual production promotion, existing
  Supabase project. No separate staging environment.
- User-selected initial production origin: `https://volo-six-woad.vercel.app`.
  Saved as Production-only `VOLO_MUTATION_ORIGIN`; this is configuration, not
  authorization or evidence of publication.

## Hosting observations and changes

November 19, 2026: correct GitHub repository already connected; no deployments or
project variables at initial inspection; system metadata enabled. Disabled
Production **Auto-assign Custom Production Domains** and saved: the UI states
production deployments need manual promotion. Changed Node.js from default 26.x
to 24.x and saved. No GitHub access expansion, Netlify change, Supabase change,
DNS/domain cutover or production deployment was performed.

Copied `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to
Vercel as Config values scoped to **Production and Preview**, after verifying
both Netlify contexts match. Confirmed saved names and scopes in Vercel. No
secret values were copied or logged. The existing `SUPABASE_SECRET_KEY` is
Production-only and write-only in Netlify. User entered it directly into Vercel;
confirmed Secret type and Production scope without revealing its value. No
`VOLO_CONFIRMATION_KEYS` exists in the current Netlify project; no new activation
or key generation was performed.

Authenticated invitation-list verification exposed a required privileged read
that was unavailable in Preview without the service key. User explicitly
approved a second Secret entry scoped only to Preview branch
`feature/volo-244-vercel-migration`, then entered and saved its value privately.
Confirmed the exact branch restriction and the separate unchanged Production
entry. It is not available to all preview branches. A fresh Preview deployment
was required to use this configuration. User completed Vercel’s email identity
check; Preview redeploy `6Xiw8cerypYDuNMA1ufQJ4nrCtrV` reached Ready in 44 seconds.
No credential source was read or secret value logged by the agent.

## Local checks

- Origin/private-header tests: new Vercel cases failed against old behavior;
  initial six tests then passed after implementation.
- Final expanded origin/alias/private-header unit checks: 12 passed.
- Invitation confirmation/completion, setup UI, recovery/reset/login input
  regressions: 40 passed.
- Typecheck and quiet lint: passed after the callback-handler fix.
- Private-cache HTTP regression: passed with Netlify and Vercel targeted-header
  precedence, A/B/anonymous isolation, public positive control and unsafe replay
  negative control.
- Mutation unit/HTTP/Server Action regression: passed, including fresh access,
  origin spoofing/rejection, bounded input and zero effects on denied calls.
- Final production build with synthetic Vercel Preview metadata: passed using
  webpack, including alias/callback and Auth deadline fixes.
- Standard production smoke: 85 passed.
- Server access checks: 31 unit tests plus the HTTP fixture passed, covering
  verified identity, current roles/membership, revocation, bounded Auth outages
  and credential boundaries.
- Local production HTTP check exposed Next's internal request URL behavior:
  exact public `Host` now selects only a fixed alias redirect/rejection. Origin
  authorization still never trusts Host. Added a failing regression then fixed
  it; the final HTTP checks passed as recorded below.
- Review exposed `/auth/confirm` bypassing Proxy. Added direct callback GET,
  HEAD and POST gates and a real-handler regression (400 before, 403 after,
  without redirects/cookies). This preserves the existing Proxy exclusions and
  callback session ownership.
- Proxy Auth transport timeout reproduced on unchanged main in a disposable
  archive, specifically a stalled body read after prior SDK calls. Hardened the
  existing five-second deadline with a local abort race around fetch/body/cancel;
  two deterministic tests failed before and passed after the fix. No retry,
  credential-rejection or cookie-cleanup policy was weakened.
- Final full Proxy checks passed: 10 unit tests and production HTTP fixture
  covering refresh/isolation, replacement redirects, assets, and Auth outages,
  timeouts, cookie preservation, sanitized failures and no detached retries.
- Real local production HTTP checks passed with explicit Host headers: alias
  GET/HEAD redirects drop query/cookies; actual callback GET/HEAD/POST rejects
  alias before effects; canonical login, health and worker no-store work.
  Node fetch normalized the custom Host in an earlier probe; the HTTP client
  with explicit Host confirmed actual application behavior.
- Approval review temporarily failed due to an account usage limit and one
  HTTP command was not executed then. Subsequent retries went through normal
  approval review successfully; no approval check was bypassed.
- Fresh whole-change review completed after callback and deadline fixes: no
  remaining critical/important findings. Reviewer noted the documented strict
  cache reporter INCONCLUSIVE outcome without RFC Cache-Status evidence.

The Node direct-TypeScript tests emit the existing module-type warning; no
package module convention was changed merely to suppress it.

## Hosted Preview evidence

- First Git-triggered build `54fMiECbn7dxdQecqyGihj945DrM` classified feature
  branch `e79cdf9` as **Production** despite configured main tracking. It failed
  closed on missing explicit production origin. Staged domains were not assigned;
  this did not publish production. The next automatic Git push correctly
  produced Preview, as recorded below.
- Explicit **Create Preview Deployment** for the same branch/SHA produced Ready
  deployment `5gG1eGWDYYmbQ3zzvzQ8qWcsfVeD` in 44 seconds.
- Exact URL: <https://volo-cl8q277y5-volo7.vercel.app/>.
- Branch alias:
  <https://volo-git-feature-volo-244-vercel-migration-volo7.vercel.app/>.
- Vercel shows Environment **Preview** and **Assigning Custom Domains Skipped**.
- Browser with the existing Vercel platform session: root navigated to the fixed
  sign-in page; `/api/health` showed `{"status":"ok"}`. Branch alias login with
  an invalid query canary reached the exact deployment `/login` with the query
  removed. Branch alias `/auth/confirm` with an invalid canary returned HTTP 403.
  No hosted token consumption, email send or app mutation was performed.
- Credential-free HTTP probes reached Vercel SSO protection (302), not the app.
  Protection was retained. These responses cannot establish application cache
  policy or authenticated isolation; the hosted cache gate remains unverified.
- Automatic Git push of documentation-only head `6064f2e` produced Ready Preview
  `8ryvj3cFSpCnJtvMGfSoMDFZqk9F` in 16 seconds:
  <https://volo-ny4wrdlsd-volo7.vercel.app/>. Environment Preview; custom domain
  assignment skipped. App source is identical to implementation `e79cdf9`.
- User signed in as administrator to the implementation Preview. No Netlify
  cookies/sessions were transferred to the new origin. Read-only checks:

| Area | Observed result |
| --- | --- |
| Dashboard | Authorized app navigation and workspace loaded |
| Members | Named member displayed by name; missing-profile fallback retained; details opens and closes with Enter; self-disable prevented |
| Profile | Seven certificate and three rating choices render; existing selections and legacy IFR value retained; no save submitted |
| Photo | Private photo loaded with nonzero natural dimensions; no upload/removal |
| Directory | Existing pilot card and detail show name, airport, certificates, legacy rating and aircraft |
| Flights | Upcoming empty state and creation form render; no flight published |
| Messaging | Authorized empty conversation list; no messages sent; delivery/realtime not exercised with hosted data |
| Moderation | Existing flight rows, timezone data and retained moderation record loaded; no hide action |
| Reports | Authorized empty report list |
| Metrics | Authorized metrics and outcomes sections loaded |
| Invitations | Initially unavailable without Preview service key; after approved branch override/rebuild, authorized empty list and send form loaded; no invitation sent |

Mobile viewport override was attempted but the observed Chrome viewport stayed
1728 pixels wide. Override was reset; no mobile verification pass is claimed.
No hosted app mutations, emails or Supabase configuration/schema changes were
performed. Invitation/recovery activation remains a separate gate because
confirmation keys/logging/callback configuration is not established by login.

## Hosted checks and remaining gates

Reviewed rebuild: <https://volo-fw0k33nd3-volo7.vercel.app/>, source `6064f2e`
(app code identical to implementation `e79cdf9`), Environment Preview, custom
production domain assignment skipped. Administrator signed in separately and
Invitations loaded its empty list and send form, proving the scoped privileged
read is configured without sending email or changing data.

Pending: hosted cache evidence and any separately activated email callbacks.
Production publication and full release checks remain separate.

Preview protection may require a user session; do not disable it to make an
anonymous smoke script pass. Record protection separately from app behavior.
No mutation test is authorized against shared hosted data by this record.

Release remains separate: full suite on selected release SHA, known-good
Netlify rollback artifact/backend compatibility, requested production hostname,
explicit user-requested promotion/cutover, production verification and retention
checkpoint. VOLO-244 is not Done and VOLO-245 must not archive the old app yet.
