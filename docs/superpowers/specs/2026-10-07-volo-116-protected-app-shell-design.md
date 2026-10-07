# VOLO-116: Protected app shell and dashboard

## Preview verification amendment

Netlify preview verification demonstrated that parameterless redirects inherit
incoming query parameters. The fixed destination is therefore
`/login?reason=authentication-required`, following the Netlify maintainers'
[documented workaround](https://github.com/opennextjs/opennextjs-netlify/issues/2209#issuecomment-1632262468).
No incoming parameter, including `reason`, is copied. This supersedes the empty
redirect-query requirement below while preserving the agreed `/login` path.

## Intent and agreed scope

Protect the existing dashboard so only a verified user with an active membership
can receive its workspace content. Protection must hold for direct requests,
refreshes, client navigation, HTML and React Server Component (RSC) responses,
prefetches, and future nested page entry points. Preserve public access and
correct unknown-route behavior.

The user approved `/login` as the destination for signed-out visitors, and
approved the route-group, page-boundary authorization, safe denial states and
local verification design. This specification records that design for review;
implementation follows a separately reviewed plan.

Use `feature/` branches, Netlify Deploy Previews and production only. There is
no staging environment. Production automatic publishing stays locked; merging
does not constitute a production release. Hosted previews share Supabase with
production: all authentication and membership write fixtures remain local and
fictional.

## Current foundations

- `app/dashboard/page.tsx` is a public placeholder with a heading, home link and
  workspace overview. The homepage links to `/dashboard`.
- VOLO-115 supplies server-only `getAccess`, `requireActiveMember` and
  `requireRole`. Each invocation verifies identity and queries current
  membership through a request-scoped client; no authorization result is cached.
- VOLO-114 supplies Proxy session refresh and response-cookie preservation.
  Proxy is not an application authorization boundary. Auth outages can already
  terminate session-bearing requests with a generic uncacheable HTTP 503.
- `/login` and user-facing authentication flows do not yet exist. VOLO-22 owns
  the eventual login/logout implementation. `/auth/confirm` remains a future
  public callback contract, not a route to implement in this ticket.
- The smoke suite currently expects public dashboard HTML and needs updating.

## Architecture and route contract

Retain the top-level root layout. Move the dashboard to
`app/(protected)/dashboard/page.tsx`; the route group does not alter `/dashboard`.
Use a small presentational group layout for shared container styling. It must
not read identity, make authorization decisions, or serialize protected content.

Render the authenticated shell, navigation and workspace overview only from
the successfully authorized page branch. Keep the shell a Server Component
using the existing typography, spacing and light/dark styles. Include the Volo
name, dashboard navigation and home link. No new menu, account profile, logout
control or identity display is needed before their associated flows exist.

Every protected page must independently await a shared server-only page-access
helper backed by VOLO-115 before constructing protected output. The helper
translates only the known access outcomes into a page decision; it does not
cache a grant or make a layout's successful decision reusable by children.
Future protected data reads must call the underlying guard at their data
boundary as well. A route group is organization, not automatic authorization.

Do not introduce a catch-all protected route: unmatched paths, including
`/dashboard/missing`, must continue to return 404. Do not add a production nested
page solely to satisfy a test. Verify the nested-entry convention with a
disposable fixture page that independently uses the real page-access helper.

### Page outcomes

| Access outcome | Behavior |
| --- | --- |
| Authorized active member or admin | Render authenticated shell and dashboard overview. |
| Unauthenticated, invalid or revoked credentials | Use Next.js `redirect('/login')` before protected content is constructed. |
| Verified identity with absent or disabled membership | Render a generic “Access denied” state with a home link, without the authenticated shell or overview. |
| Identity or membership service unavailable | Render a generic “Unable to verify access” state with a same-route retry link and home link, without protected output. Existing Proxy HTTP 503 behavior remains valid when it terminates the request first. |
| Unexpected programming/configuration error | Propagate to the framework error boundary; never convert it into an authorized result or expose raw error text in custom UI. |

Denial UI is page content, not an API 403/503 contract. Next.js streaming may
retain HTTP 200 for rendered failure UI; tests assert the safe state and absence
of protected data rather than requiring unsupported page status manipulation.
Redirects likewise may be represented by an HTTP redirect or the framework's
streamed/RSC redirect protocol. Leave experimental auth interrupts disabled.

Any exception handling must let Next.js redirects and other framework control
flow propagate. Do not catch the redirect thrown by the page helper.

## Public login placeholder and handoff

Add public `app/login/page.tsx` with a “Sign in” heading, the message “Sign-in is
not available yet”, and a home link. It has no form, credential field, mutation,
account creation or automatic redirect based on session state. This allows the
destination to exist now without a loop for signed-in users lacking membership.
VOLO-22 replaces its body with real login/logout behavior later.

Protected redirects use the fixed same-origin `/login` path. Do not copy query
parameters into a `next` value or forward tokens or arbitrary return URLs. Record
the agreed destination in the auth handoff documentation and VOLO-22 ticket.
The homepage and `/api/health` remain public. Future auth/callback routes stay
outside the protected group; this ticket neither implements them nor changes
hosted Supabase callback settings. Existing Proxy verification behavior for
requests carrying session cookies remains unchanged.

## Freshness, caching and data exposure

Use the existing fresh access checks without React cache, Next cache directives,
module-level clients/promises, or durable authorization grants. Keep membership
queries and identity requests uncached. Explicitly make protected page rendering
dynamic under the installed Next.js conventions and verify private/no-store
responses for both authorized and denied HTML/RSC, including anonymous requests.
If explicit response headers are required, apply a narrowly scoped policy that
preserves the Proxy response, cookies and correct 404 behavior. Do not broaden
this into VOLO-118's full application cache audit.

No access token, refresh token, cookie value, full Supabase user object or raw
backend error may appear in HTML, RSC, browser props, logs or Jira. No Client
Component needs identity props for this shell. Static dashboard labels are not
secrets, but they are useful denial assertions; synthetic private markers in the
local fixture verify that data cannot cross the boundary.

Each new server request rechecks current membership. Previously delivered
content cannot be retracted from a browser, and this ticket does not promise
instant invalidation of client router history or already displayed content.
Navigation that fetches new content and refreshes must enforce current access.
Use appropriate protected navigation prefetch behavior to avoid unnecessary
work or relying on a prefetched decision as a durable grant.

## Verification

Extend the existing real SDK/Next local fixture approach, exercising the actual
page helper and dashboard implementation rather than a duplicated decision
algorithm. Use fictional Auth and membership services, generated SDK cookie
jars, and an outbound-network guard. Include Proxy refresh where testing the
complete request path; never seed cookies or add test endpoints to production
routes.

Cover:

- Anonymous, malformed, forged and revoked credentials reach `/login` without
  workspace output. The public login placeholder renders and does not loop.
- Active member and admin receive the shell and overview; missing/disabled
  membership receive only the safe denied state. User metadata cannot grant
  access. Changes to membership are enforced on subsequent requests with the
  same session.
- Auth/membership outages and malformed responses reveal no protected content
  or raw error details. A retry performs a fresh check. Existing bounded
  transports continue to govern service requests.
- Direct HTML requests, repeated refreshes, full and targeted RSC navigation,
  and prefetch variants never expose protected fixture markers on denial.
  Respect Next.js's canonical `_rsc` redirects when testing response variants.
- A fixture-only nested page performs its own guard, including targeted
  navigation while the shared layout is retained. Layout output does not
  authorize or hide independently executing page/data code.
- Authorized and denied protected responses are private/no-store; refresh
  cookies survive the complete Proxy-to-page flow. Concurrent users do not
  share decisions. No credential canaries leak into bodies, headers, output or
  browser assets.
- Homepage, login, health and required public conventions remain available;
  unknown nested page and API paths return 404 rather than login or homepage.

Update ordinary smoke tests for anonymous dashboard denial, public login,
homepage navigation and health/404 behavior. Retain meaningful HTML/RSC
assertions instead of checking only a final 200 after following a redirect.
Add the protected-page verification command to CI and update current behavior
in README, environment, preview verification and relevant auth handoff docs.
Historical deployment evidence remains historical rather than being rewritten.

Run typecheck, lint, production build, the relevant existing client/Proxy/access
and server-only boundary checks, and the new page suite. CI verifies the default
bundler and existing database policies. Use local webpack builds if the known
host worker restriction persists. Run anonymous smoke/browser checks against
the exact PR Deploy Preview head; authenticated write fixtures remain local.
Record CI/deploy/head and results in VOLO-116, keeping it In Progress until merge.

## Exclusions

No login/logout/signup/reset/invitation implementation, hosted callback
activation, database migration, membership mutation, service-role credential,
new application feature, admin-only screen, or production release. VOLO-117
owns mutation/input/cross-origin defenses; VOLO-118 owns the wider private-cache
integration. This ticket still verifies the cache behavior required for its
own protected pages.
