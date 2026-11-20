# VOLO-244 verification

Status: implementation and preview preparation in progress. Production cutover
has not been performed. This record does not certify a Vercel deployment yet.

## Source and destination

- Base: merged main `3e2a480f22311704fe1e2244eb6391037f6641de` (PR #124).
- Branch: `feature/volo-244-vercel-migration`.
- Destination selected by user: [VOLO / volo](https://vercel.com/volo7/volo).
- Approved design: automatic previews, manual production promotion, existing
  Supabase project. No separate staging environment.
- Existing project domain: `volo-six-woad.vercel.app`. Final production hostname
  remains a cutover decision.

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
Production-only and write-only in Netlify; user entry of the original value into
Vercel Production is pending. No `VOLO_CONFIRMATION_KEYS` exists in the current
Netlify project; no new activation or key generation was performed.

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
  it; the final HTTP rerun is pending.
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

## Hosted checks and remaining gates

Pending: Production secret provisioning, exact deployment SHA and
canonical/branch URL verification, hosted build evidence, anonymous smoke/cache
observations, approved signed-in reads, member names/certificates/ratings,
photos/directory/flights/messages, any activated email callbacks, and deployment verification.

Preview protection may require a user session; do not disable it to make an
anonymous smoke script pass. Record protection separately from app behavior.
No mutation test is authorized against shared hosted data by this record.

Release remains separate: full suite on selected release SHA, known-good
Netlify rollback artifact/backend compatibility, requested production hostname,
explicit user-requested promotion/cutover, production verification and retention
checkpoint. VOLO-244 is not Done and VOLO-245 must not archive the old app yet.
