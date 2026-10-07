# VOLO-114: Supabase session refresh through Next.js Proxy

## Intent and agreed scope

Keep a signed-in browser's Supabase session usable across server-rendered
requests. Refresh cookies must reach both the current application request and
the browser's next request, without crossing user boundaries or losing cache
protections. Use `getUser()` for server verification initially.

The user approved this direction after VOLO-113 merged as PR #14. That foundation
is on `main` at `1dc2d71`. VOLO-114 adds session refresh; VOLO-115 supplies verified
identity/current membership guards and VOLO-116 protects the application shell.

Constraints:

- Next.js 16.3.8 App Router, Node.js 24, strict TypeScript, generated `Database`.
- Installed Supabase JS 2.117.2 and SSR 0.12.7; use the existing validated public
  configuration. No privileged credentials or shared server client.
- Feature branches use `feature/`. Netlify Deploy Previews and production only;
  production auto-publishing remains locked.
- Preview and production share hosted Supabase. Verification uses fictional
  sessions and a loopback stub or disposable local backend, never hosted users,
  account mutations, email or database writes.
- No login/logout/signup/reset/invitation routes, hosted callback configuration,
  membership queries, application redirects or production release in this work.

## Approach

Add a root `proxy.ts` delegating to a server-only module such as
`lib/supabase/proxy.ts`. Keep the root entry small and export a statically
analyzable matcher. Proxy uses Next.js's default Node runtime, without a `runtime`
override.

The helper creates a fresh `createServerClient<Database>` for each request using
the existing public config helper and a Proxy-specific cookie adapter. The
VOLO-113 factory based on `await cookies()` remains for Server Components,
Route Handlers and their supported write contexts; Proxy owns `NextRequest`
and `NextResponse` directly. Do not force that factory's cookie store into Proxy
or broaden its interface merely to accommodate this context.

Call `auth.getUser()` to validate the session and let the SDK refresh expired
credentials. Do not use `getSession()` alone for identity, trust a decoded JWT,
or forward a user-supplied identity header as authentication. Do not serialize
the user, token, client or session into page props, response bodies or headers.

Alternatives considered:

- `getClaims()` can reduce remote verification work but introduces a different
  verification/revocation contract. Defer that optimization until measured.
- Refreshing independently in each Server Component cannot reliably persist
  cookies and can repeat refresh work. Proxy owns the refresh step instead.

## Request and response cookie ownership

The adapter implements the installed SSR SDK's `getAll` and
`setAll(updates, headers)` contract.

1. `getAll` reads the current request's complete cookie collection.
2. `setAll` retains every update and its full SDK options, including chunk
   deletion, expiry, path and same-site settings. Mutate the incoming cookie
   view so downstream Server Components receive the refreshed session during
   this request. Deletion removes the cookie from that incoming view.
3. Construct the pass-through response with refreshed request headers through
   `NextResponse.next({ request: { headers } })`. Do not expose incoming headers
   with `NextResponse.next({ headers })`.
4. Apply every outgoing cookie update and SDK cache-protection header to the
   returned response. Accumulate updates across callbacks; a later empty SDK
   headers object must not erase protections supplied earlier.

Request/client/cookie state is local to one invocation. Never cache it in module
state. Refreshing user A must not read or write user B's session.

Provide a small explicit response-finalization helper for the same request's
replacement responses. It copies accumulated session cookies with options and
the session cache protections onto a supplied `NextResponse`, preserving that
response's status, location and unrelated headers. It must not copy arbitrary
incoming headers or internal request-forwarding headers onto a redirect.
Test it with a synthetic redirect even though this ticket adds no redirect flow.
Callers must return the finalized response rather than create a new response
after finalization and lose the cookies.

Cookie/header write errors remain visible. No catch-and-continue path may report
successful persistence after a write fails.

## Cache policy

Preserve the installed SDK's protections when cookies change:

- `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`
- `Expires: 0`
- `Pragma: no-cache`

Apply private/no-store protections to session-bearing matched responses even
when verification succeeds without a cookie update. Otherwise cache behavior
could depend on whether this particular request refreshed. Generic Auth failure
responses are also uncacheable. Anonymous public responses need not become
private solely because Proxy matched them.

This covers Proxy-owned session responses. VOLO-118 still owns the broader
private-content/Route Handler/Server Action caching audit.

## Matcher and anonymous traffic

Match application page and API requests, including `/`, `/dashboard`, future
`/auth/confirm` and future auth pages/APIs. Do not exclude prefetch requests as a
substitute for reducing authorization work; Proxy performs no membership query.
HTML and RSC requests must receive consistent session handling.

Exclude `/_next/static`, `/_next/image`, the exact public `/api/health` endpoint
(including its trailing-slash variant), favicon/robots/sitemap assets and the
repository's public SVG files. Keep the asset exclusion explicit and tested;
do not bypass an application route merely because its name contains a dot.
Future public assets must be added to the exclusion policy and its tests.
Include Next.js normalized data requests in matcher tests rather than assuming
that an internal-looking URL always bypasses Proxy.

Requests without this project's session cookie or session-cookie chunks pass
through without an Auth network request. Recognize the storage name used by the
configured SDK/project; unrelated cookies and a PKCE verifier alone do not count
as a session. An anonymous `/auth/confirm` remains reachable. No authentication
redirect loop is possible because this ticket introduces no redirects.

## Invalid credentials and Auth failures

Treat these outcomes separately:

- **No session:** pass through anonymously, without an Auth network call.
- **Malformed/invalid/expired-and-unrefreshable session:** for recognized
  credential rejection or absent session after decoding, remove only this
  project's session cookie and session chunks from the incoming request and
  expire them on the response. Preserve unrelated cookies and a pending PKCE
  verifier. Continue anonymously; no identity is granted by Proxy.
- **Temporary failure:** network errors, timeouts, rate limiting and Auth server
  failures return a generic uncacheable HTTP 503. Do not render the matched
  application request using an unverified session, clear a potentially valid
  session merely because Auth is unavailable, or return raw SDK error details.
- **Unexpected adapter/configuration failure:** fail visibly and safely; do not
  downgrade it to a successful anonymous request. Existing configuration
  validation stays sanitized.

Use bounded Auth HTTP timeouts and account for the installed SDK's refresh
retries when bounding total verification work. The implementation plan must
define and test that bound, cancellation and prevention of late cookie writes;
it must not rely on an unbounded fetch or a detached refresh after response
finalization. Never classify every SDK error as invalid credentials.

Production logging, if needed, uses fixed outcome labels without token, cookie,
URL query or SDK error-body values. Tests inspect synthetic cookies internally
without printing them.

The existing dashboard remains a public placeholder until VOLO-115/116. Tests
use a fixture-only protected endpoint with server verification to prove invalid
credentials cannot expose protected content; do not claim that this ticket
alone secures the application or that Proxy verification replaces endpoint guards.

## Verification

Use failing tests before implementation, then real SDK behavior in a disposable
Next.js fixture with synthetic configuration and a loopback Auth stub. Copy the
real modules/Proxy into that fixture, never the checkout's `.env` files, and
deny unexpected outbound requests. Keep readiness, subprocess and HTTP timeouts
bounded and clean up temporary apps/processes.

Required coverage:

1. Matcher tests using installed Next.js testing helpers: page/API/auth routes,
   HTML/RSC/prefetch cases, normalized data requests, known assets, health and a
   dotted application route.
2. Anonymous and PKCE-only requests require no Auth call and leave cookies alone.
3. An expired fictional session refreshes; a downstream Server Component sees
   the fresh session on the same request and the browser cookie jar persists it
   on the following request without another unnecessary refresh.
4. Two concurrent fictional users remain isolated. Large sessions exercise
   actual SDK cookie chunks, replacement/deletion and cookie option preservation.
5. Malformed cookies, invalid access credentials and rejected refresh tokens
   become anonymous with correctly scoped cleanup; unrelated cookies/verifiers
   survive. The fixture protected endpoint denies access.
6. Auth server/rate-limit/network/hanging-request failures produce generic 503s
   with no token/error leakage, false identity, destructive cookie cleanup or
   late writes. Adapter failures cannot report persistence success.
7. Pass-through and synthetic replacement/redirect responses retain every
   session cookie and cache protection. No incoming/internal headers leak into
   browser-visible headers, HTML, RSC or JSON, apart from intended Set-Cookie.
8. Session-bearing responses are private even when no refresh occurs. Anonymous
   public pages, static assets and health remain usable without Supabase access.
9. Existing client integration, privileged boundary/canary checks, typegen,
   TypeScript, lint, build and unit/route smoke checks continue to pass. CI uses
   fictional public configuration. Add Proxy verification to the app CI job.
10. Fresh branch review, default-bundler hosted CI and the latest PR Deploy Preview
    pass. Public preview smoke/browser checks establish availability only;
    session refresh evidence comes from the isolated fixture.

Local webpack verification remains available for this host's documented
Turbopack worker limitation; committed app scripts retain the default bundler.

## Handoff

Document the matcher, refresh/response ownership, failure policy and response
finalizer for VOLO-115/116/118 and future auth flows. Record tested commit, CI run,
preview URL and isolated verification results in VOLO-114 without credentials.
Keep the issue In Progress until implementation and verification are merged.
Do not publish production as part of merging this ticket.

## References

- Installed Next.js guides: `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`
  and `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`.
- Installed SDK server/cookie contracts: `node_modules/@supabase/ssr/dist/module/`.
- [VOLO-113 client design](2026-10-06-volo-113-supabase-clients-design.md).
- [Environment and client usage](../../environment-configuration.md).
- [Auth callback contract](../../auth-callbacks.md).
