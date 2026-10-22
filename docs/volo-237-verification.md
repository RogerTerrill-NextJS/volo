# VOLO-237 — Homepage member entry routing

Approved bounded implementation and PR creation on
`feature/volo-237-homepage-routing`, based on reviewed VOLO-183 / `7db219b`.
Installed Next.js redirect, cookies, authentication/DAL and CDN-caching guides
were reviewed before application changes.

## Behavior

- The starter homepage is replaced with a dynamic server page using the existing
  `getPageAccess` verified identity/current membership boundary.
- Anonymous visitors receive the existing fixed
  `/login?reason=authentication-required` redirect. Active members, including those
  without profiles, receive `/dashboard/flights?source=home`. The fixed query avoids
  Netlify inheriting incoming return/token-looking query parameters. No supplied
  URL or query determines the destination. Login itself keeps its existing behavior.
- Inactive/unadmitted users receive the existing Access denied component at `/`;
  membership failures receive existing unavailable/retry feedback. Auth transport
  failures continue to fail closed in the existing Proxy. No new access grant,
  profile requirement, durable cache or schema change is added.
- `/` joins the existing private page-path classification. Browser/CDN/Netlify
  no-store headers cover anonymous/member redirects, denied/unavailable states,
  HTML/RSC and prefetch responses. Health and hashed static assets remain public
  controls. Existing direct login/setup/recovery and protected routes are retained.

## Verification

| Check | Result |
| --- | --- |
| Initial root private-policy unit | Expected failure: root was public |
| Initial compiled homepage check | Expected failure: static cache headers |
| Preview root/cache/query-inheritance controls | Expected failures before verifier updates |
| Focused cache-policy, preview-verifier and shared Proxy units | 17 passed |
| Existing compiled cache/isolation runner | Passed, including new actual-homepage cases |
| Offline-configured production build | Passed |
| Production smoke tests | 8 passed |
| Next route type generation, TypeScript, repository-wide ESLint | Passed |
| Independent read-only review | No actionable findings after adding hosted query-inheritance coverage |
| Real-Auth browser verification | Anonymous, active profileless, revoked and reactivated membership passed |

The existing compiled cache fixture now retains the actual production homepage.
Its new cases alternate anonymous and two member jars on identical URLs, check
fixed destinations and all private headers across HTML/RSC/prefetch, and verify
revoked/absent membership plus Auth/membership outages. Anonymous redirect chains
settle on the sign-in page without looping. Existing private HTML/RSC/JSON cache
isolation, refresh, failure, static and intentional-public control checks passed.

The related Proxy regression initially retained the old public-home assertion;
it now explicitly checks private root responses and retains an unrelated public
control, including code-verifier-only jars making no Auth calls. Its loopback
checks required the normal local-server permission after the sandbox denied binds.

Next.js serializes the original request URL in some RSC responses; assertions
check the redirect destination rather than incorrectly rejecting that input
serialization. Actual RSC navigation can use a 200 with a redirect instruction,
while static prefetch can omit dynamic content entirely. The verifier explicitly
handles these forms without relaxing private headers or destination checks.

The hosted preview verifier now reads static-asset references from login, checks
both clean and query-bearing root requests alongside dashboard, and uses health
and hashed assets as public controls. Its unit regressions reject a cacheable
root, wrong destination and inherited homepage query parameters, while retaining
strict CDN hit/storage rejection and inconclusive-evidence behavior. The existing
real-Auth fixture also copies the production root; its full-suite public control
moves to health and its asset source to login.

Browser QA used an owned disposable local Supabase account and the existing real
Auth/app helper. Root with an external-looking query reached sign-in; Back to home
returned safely to sign-in. Signing in and opening root led a profileless member
to Upcoming flights with only the fixed source query. Disabling membership made
root render Access denied; reactivation restored the flight destination. Desktop
and 390px mobile navigation were checked. No hosted account/data/email/settings
writes were used.

## Files and limits

- Product: `app/page.tsx`, `lib/http/protected-path.ts`.
- Existing verification: `scripts/verify-private-cache.mjs`,
  `scripts/verify-preview-cache.mjs`, `scripts/verify-auth-integration.mjs`;
  `tests/helpers/cache-fixture.mjs`, `tests/helpers/real-auth-app.mjs`;
  `tests/private-response.unit.mts`, `tests/preview-cache.test.mjs`,
  `tests/supabase-proxy.unit.mts`,
  `tests/smoke.test.mjs`.
- Documentation: this note, `docs/private-caching.md`, `docs/preview-verification.md`.

Full historical/combined Auth suites are left to CI under the focused-test policy.
Hosted Deploy Preview verification and production release verification remain
separate; local evidence does not prove Netlify CDN non-storage. No production
publication, migration, new dependency or founder decision remains for this scope.
Unrelated `AGENTS.md` and `docs/audits/` changes are preserved and excluded.
