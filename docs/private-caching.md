# Private response caching

VOLO-118 shares one server-only policy in `lib/http/private-response.ts`:

| Header | Value |
| --- | --- |
| Cache-Control | private, no-cache, no-store, must-revalidate, max-age=0 |
| CDN-Cache-Control | no-store |
| Netlify-CDN-Cache-Control | no-store |
| Expires | 0 |
| Pragma | no-cache |

The helper replaces conflicting policies and preserves unrelated headers,
Vary, redirect locations and multiple cookies. Netlify's targeted field takes
precedence over generic CDN and browser fields; it may be consumed at the edge.
Vary: Cookie alone is insufficient protection.

Proxy finalization applies the policy after SDK metadata/cookie preservation on
project-session requests, cookie updates, verification failures and protected page
paths, including anonymous redirects. `lib/http/protected-path.ts` registers
`/dashboard` and its descendants with complete segment matching. Add future
protected roots explicitly; classification grants no access. Existing matcher
exclusions preserve static/image/health/public asset behavior.

Writable server clients apply the policy through the caller's header sink before
persisting SDK cookies, including initial session creation and deletion. Sink
failures remain visible and prevent cookie writes. Every JSON mutation adapter
response uses the policy, including malformed/denied/error/method responses.
Next owns Server Action browser headers and overwrites them with its own
no-cache/no-store policy; session-bearing Actions retain both CDN no-store fields.
Value-returning Action helpers cannot set arbitrary HTTP response headers.

Protected rendering stays dynamic. Identity and membership reads stay no-store
and independently verify current access. Never put tokens, identities,
memberships, grants or personalized DTOs in shared module state, `use cache`,
`unstable_cache`, static generation or public ISR. Anonymous home and hashed
assets retain public caching. VOLO-154 makes the login form dynamic/private even
without a session and keeps every login POST outcome private/no-store. The cache
classification grants no access; login does not create active membership.

## Verification and limits

See [session integration and auth handoff](session-integration.md) for the separate
real Auth/PostgREST suite and the division between local, simulated and hosted evidence.
VOLO-120 tracks the approved deferral of Netlify Age/non-storage reporting;
it is not a passed hosted cache check.

Run `npm run test:cache` and `npm test`. Disposable production-built cache fixtures use
the real Proxy/SDK/guards and fictional loopback services. A/B/anonymous/A requests
use identical HTML/RSC/prefetch/JSON URLs, with fresh authorization on personalized
responses. Warm success followed by membership disablement or service outage
cannot replay old output. Rotation, rejected-session deletion, chunk replacement,
replacement redirects and SDK session establishment also run in existing suites.
Dynamic prefetch can omit the private page entirely: those variants perform no
membership query and still receive no-store policy.

A small conservative shared-cache model honors targeted-header precedence, serves
an explicit public positive control, and refuses protected responses. An unsafe
copied response proves the isolation assertion detects A replayed to B. This is
policy evidence, not an emulation of Netlify infrastructure. Compiled client-import
denials cover both policy modules, including marker-removal controls. Canaries
cover bodies, non-cookie headers, browser bundles and output; caller-owned cookies
are the sole permitted credential transport.

Chrome browser evidence on October 7, 2026, against an owned loopback fixture:

| Navigation | Visible result | Membership reads |
| --- | --- | --- |
| A → public → Back | Already-delivered A page restored | Stayed at 33 |
| Disable A → Forward/Back | Historical A page restored | Stayed at 33 |
| Refresh disabled A | Access denied, no subject | Increased to 34 |
| Reactivate A → Refresh | A page | Increased to 35 |
| Sign out → Refresh | Fixed login destination | No authenticated grant |
| Sign in B → fresh private navigation | B only, no A | Increased to 37 across B navigations |

Screenshots captured the refreshed denial and B's page; owned fixture and browser
tabs were closed. Previously delivered DOM/RSC cannot be retracted by HTTP policy.
Do not promise instant remote revocation or add polling to imitate it. Future
login/logout flows own supported Router Cache invalidation and fresh session-change
navigation. Every new protected server request must reauthorize.

For an exact reviewed Deploy Preview, run:

```sh
SMOKE_BASE_URL=https://deploy-preview-<PR-number>--voloapp.netlify.app node scripts/verify-preview-cache.mjs
```

The report makes anonymous GET/HEAD requests only, repeats identical protected
HTML/RSC/prefetch and public/static URLs three times, and prints whitelisted cache
policy/status/age fields with cookie count. Require no-store and no reported
shared hit/storage/positive age. Require affirmative `fwd=bypass` or forwarded
`stored=?0` evidence from reported cache layers. Missing or miss-only status is
INCONCLUSIVE (exit 2), never PASS; explicit `hit`/`stored` Booleans fail (exit 1).
A miss alone is insufficient. Preserve RSC negotiation.
Hosted previews share production Supabase, so no fictional hosted cookies,
authenticated writes or hosted test users are used. These anonymous checks cannot
prove authenticated CDN isolation. VOLO-110 owns that procedure once real downstream
auth flows and an explicitly approved account exist. Production publishing stays
locked; a merge is not a release. There is no staging environment.

VOLO-21/22/23 and invitation/reset callbacks must apply the common policy to all
session/token responses, success and failure, even before membership exists.
Writable SDK callers supply the existing response-header sink. Callback/auth
origin/input/admission rules remain the owning flow's responsibility.

Sources: installed Next.js 16.3.8 CDN caching, caching without Cache Components,
cookies, headers, prefetching and staleTimes guides; installed Supabase SSR cookie
metadata behavior; [Netlify cache precedence](https://docs.netlify.com/build/caching/caching-overview/)
and [Next.js runtime](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/).
