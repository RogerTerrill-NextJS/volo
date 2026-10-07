# Private Content and Session Cache Boundaries

Date: 2026-10-07
Issue: VOLO-118 — Prevent caching of private content and session-bearing responses
Status: Approved by the user; implementation awaits the written plan review.

## Intent and success criteria

Keep private workspace content, authorization decisions and session cookies
request-specific. A shared browser-independent cache must never give one visitor
another visitor's content or cookies, including after membership revocation or a
backend outage. Preserve useful caching for unrelated public/static resources.

The user approved a shared browser/CDN response policy, isolation tests covering
HTML/RSC/prefetch/JSON/redirects/cookies, browser history characterization and a
downstream auth-flow handoff. Use feature/ branches and Netlify Deploy Previews;
there is no staging environment. Production publishing remains locked. Hosted
previews share production Supabase, so authenticated tests and writes use only
fictional loopback services. Hosted verification is anonymous and read-only.

## Current inventory

- `app/(protected)/layout.tsx` exports `dynamic = "force-dynamic"`. Dashboard
  independently calls `getPageAccess`; the layout is not an authorization grant.
- `getAccess` independently verifies identity and current membership. Auth and
  membership fetches use no-store; there is no shared authorization cache.
- Proxy refresh applies browser private/no-store protections when a project
  session cookie is present or verification fails, and preserves cookie updates
  through its response finalizer. It currently has no explicit CDN policy.
- The writable server Supabase client applies SDK response headers before
  writing cookies through the caller's header sink. Read-only clients cannot
  persist a browser session.
- The JSON mutation adapter has its own private/no-store headers. Next controls
  Server Action wire status and headers; the Action helper cannot return a custom
  HTTP response. No product mutation or callback/session-establishment handler
  exists. `/api/health` is the only product Route Handler and is public.
- The homepage and current login placeholder are public. Hashed Next assets and
  public assets are not personalized and must not inherit private route policy.

## Selected approach

Use a small server-only response-policy helper shared by the existing response
owners. Retain dynamic protected rendering and uncached identity/membership
reads. Add explicit CDN directives rather than relying on Vary: Cookie, SDK
defaults or the absence of public caching directives.

Rejected alternatives: repeating headers independently in each adapter invites
drift; globally disabling caching unnecessarily affects public/static responses.
Do not introduce a custom cache, new dependency, new auth system, schema change,
privileged client, product endpoint or global client polling mechanism.

## Shared response contract

Provide `applyPrivateResponseHeaders(headers: Headers): void` in a server-only
module, with these effective directives:

| Header | Value |
| --- | --- |
| Cache-Control | private, no-cache, no-store, must-revalidate, max-age=0 |
| CDN-Cache-Control | no-store |
| Netlify-CDN-Cache-Control | no-store |
| Expires | 0 |
| Pragma | no-cache |

Apply by replacement, never append a second conflicting cache policy. Override
earlier public/s-maxage/stale directives in all three cache-control fields. The
helper preserves unrelated headers, response status/body/location, Vary and
every Set-Cookie field; it does not copy request headers or rewrite cookies.
Repeated application is safe. It grants no authorization and owns no effects.

Netlify gives its targeted CDN field precedence over the generic CDN and browser
fields. Netlify may consume the targeted field rather than expose it downstream;
hosted verification must assess effective cache behavior and exposed downstream
directives, not require that consumed header to appear in a browser response.

## Response owners and protected paths

1. **Proxy finalizer:** apply the policy after SDK metadata/cookie preservation
   for project session-bearing requests, cookie updates, verification failures,
   and known protected page paths even when anonymous. Preserve the existing
   restriction against replacing failed verification with a successful response.
   Exercise redirects and JSON replacements through the same finalizer.
2. **Protected path classification:** explicitly recognize `/dashboard` and its
   descendants with segment boundaries, excluding lookalikes such as
   `/dashboard-public`. This classification only controls cache policy. Future
   protected roots must register here and retain independent server checks.
   Do not treat all `/api/*`, public assets or arbitrary dotted paths as private.
3. **Writable server client:** merge SDK headers into the common policy before
   invoking the caller's existing response-header sink and before cookie writes.
   Preserve its ownership/error contract and any unrelated SDK metadata. A sink
   failure must remain visible and must not silently persist cookies.
4. **JSON mutation adapter:** use the common policy on every adapter-created
   response, including denied/malformed/method/error results. Do not change
   origin, authorization, byte limits, result shape or effects.
5. **Server Actions:** retain Next's own no-store behavior, strict origin guard
   and request-scoped authorization. Session-bearing Action responses additionally
   receive Proxy policy; SDK cookie writes invoke the common sink contract. Test
   actual compiled Action responses. Do not claim the value-returning wrapper
   can set arbitrary response headers, or manufacture a product Action.

The Proxy matcher continues to exclude exact health/static/image/public asset
paths. Public anonymous homepage/login responses keep their existing framework
caching. A session-bearing request to a public page is private; a request to an
unpersonalized excluded static asset does not need Auth refresh or private policy.

## Server data and rendering

Keep protected pages dynamically rendered and identity/membership reads explicitly
no-store. Never place tokens, identity, memberships, authorization results or
personalized DTOs in unstable_cache, use cache, static generation, shared module
state or public ISR. Do not enable Cache Components or change global rendering
configuration for this task. Preserve the fixed unauthenticated redirect to
`/login?reason=authentication-required` and safe outage/denial states.

Verify a production-built protected route is absent from prerendered private
output and that repeated requests cause fresh authorization/backend reads. A
successful earlier request must not supply fallback private content after an
outage or revocation. Tests must use the same URL for alternating subjects;
unique user query parameters would conceal a shared-cache isolation defect.

## Browser history and session changes

HTTP cache directives govern response storage; they cannot retract a DOM or RSC
payload already delivered. Next can reuse client history/layout state during
back/forward navigation even for dynamic routes. Do not advertise instantaneous
remote revocation, and do not add polling or experimental staleTimes settings as
an invented guarantee.

Use an actual browser against a disposable local production fixture to observe
member A → public page → back, membership disablement → back/forward → refresh,
and session change A → signed-out → B. Record whether each navigation reaches the
server or restores already-delivered state. Every new protected server request
must reauthorize and reject revoked/signed-out access; B's fresh navigation must
never receive A's output or cookies. No server cache may replay A's payload.

Future login/logout flows own explicit Router Cache invalidation/session-change
navigation using installed supported Next APIs. Document this handoff rather
than building login/logout in VOLO-118. Browser history observations are manual
evidence and must not be mislabeled as coverage supplied by repeated HTTP calls.

## Verification design

- Unit-test exact policy replacement, idempotence, preservation of unrelated
  headers/multiple cookies and protected-path segment boundaries. Prove these
  assertions fail before implementation; add a compiled client-import denial for
  the server-only policy module.
- Extend existing disposable production-built fixtures; use the real SDK,
  product Proxy/guards and fictional loopback Auth/PostgREST. Alternate A/B/
  anonymous on identical URLs and HTML/RSC/prefetch variants. Assert subject and
  cookie isolation, fresh membership reads, disabled membership, safe outages and
  no private fallback content. Include valid sessions, refresh rotation,
  rejected-session deletions and successful rotation followed by outage.
- Exercise protected JSON reads and callback/session-bearing redirect responses
  only in disposable fixtures. Include SDK-owned cookie establishment on a
  previously anonymous request, and Proxy replacement with conflicting public
  cache directives. All effective browser/CDN policies remain private/no-store.
- Keep mutation API/fetched/native Action fixtures passing with unchanged effect
  semantics. Check effective headers at each response owner and recognize
  framework-controlled Action responses separately.
- Add a small standards-based local shared-cache harness honoring the selected
  CDN/header precedence. Warm a deliberately public control and demonstrate reuse;
  show protected/session-bearing responses are never retained across alternating
  subjects. Include an intentionally weakened fixture-only policy to prove this
  test detects replay. This harness models policy, not Netlify infrastructure.
- Check public anonymous home/login and hashed Next assets retain their intended
  caching, with no unexpected Auth calls or cookies on excluded asset requests.
  Scan HTML/RSC/JSON, non-cookie headers, browser assets and output for fictional
  credential/error canaries. Only the correct caller's Set-Cookie is permitted.
- Run full existing application/client/Proxy/access/protected-app/mutation/boundary
  checks plus new cache tests, typecheck, lint and production build. Hosted CI
  verifies the default bundler and unchanged database/RLS checks.
- Keep browser controls local-only, fictional and disposable. The fixture can
  provide visible test-only sign-in/out and membership controls for browser
  automation; they never ship, read real .env credentials or contact hosted Auth.
  Close owned servers and remove owned temporary fixture files after checks.

## Hosted evidence and downstream handoff

Create one feature PR after local verification and fresh whole-branch review.
Verify exact-head CI and automatic Deploy Preview, without production publishing.
Make repeated anonymous requests to dashboard HTML/RSC/prefetch/redirects and
public/static controls; record Cache-Control, CDN-Cache-Control when exposed,
Age/Cache-Status and absence of Set-Cookie/private workspace output. A cache miss
alone does not prove uncacheability; require no-store policy and repeated bypass/
non-storage evidence. Preserve Next's RSC negotiation and required headers.

Do not use synthetic hosted session cookies or hosted authenticated writes to
extend coverage. Preview cannot establish cross-user authenticated CDN isolation
without real sessions; record that limitation and the authenticated procedure
needed when VOLO-110's downstream auth flows exist.

Update environment/preview/auth handoff docs and Jira evidence. VOLO-21/22/23 and
future invitation/reset callback handlers must apply this policy on session/token
responses, success and failures alike, including before a membership exists.
VOLO-110 retains hosted session/callback verification. Mark VOLO-118 Done only
after merge verification; a merge is not a production release.

## Sources inspected

- Installed Next.js 16.3.8 guides: CDN caching, caching without Cache Components,
  cookies, response headers, prefetching and staleTimes; installed Supabase SSR
  cookie metadata behavior. Installed guides take precedence over remembered APIs.
- [Netlify cache directives and header precedence](https://docs.netlify.com/build/caching/caching-overview/).
- [Netlify Next.js runtime overview](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/).

## Review focus

Check that CDN-specific public headers cannot survive a private finalization;
anonymous protected redirects cannot become shared-cache entries; SDK cookie
establishment is protected even without an incoming session; multiple cookies
and response replacements preserve ownership; dynamic/prefetch variants and
backend failures do not replay stale private output; and browser history evidence
is distinguished from new server authorization. Verify static cacheability is
preserved and no test control or secret is deployed.
