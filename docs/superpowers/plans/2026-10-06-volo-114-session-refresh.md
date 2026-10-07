# Proxy Session Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify and refresh Supabase sessions before application rendering, preserving cookies and cache protections through the current and subsequent requests.

**Architecture:** A small root Proxy delegates to a request-scoped SDK adapter. A bounded, client-local Auth transport prevents SDK retry loops from exceeding the verification deadline. Cookie updates and response metadata remain owned by the invocation and are finalized onto its pass-through or replacement response.

**Tech Stack:** Next.js 16.3.8, Node.js 24, strict TypeScript, Supabase JS 2.117.2 / SSR 0.12.7, Node tests and disposable Next.js integration fixtures.

**Spec:** `docs/superpowers/specs/2026-10-06-volo-114-session-refresh-design.md` (approved).

## Global Constraints

- Next.js 16.3.8 App Router, Node.js 24, strict TypeScript, generated `Database`.
- Installed Supabase JS 2.117.2 and SSR 0.12.7; use the existing validated public configuration. No privileged credentials or shared server client.
- Feature branches use `feature/`. Netlify Deploy Previews and production only; production auto-publishing remains locked.
- Preview and production share hosted Supabase. Verification uses fictional sessions and a loopback stub or disposable local backend, never hosted users, account mutations, email or database writes.
- No login/logout/signup/reset/invitation routes, hosted callback configuration, membership queries, application redirects or production release in this work.
- Preserve VOLO-113 browser/server factory interfaces and generated database types. Keep new test routes inside disposable fixtures.

## Review Focus

- Auth sends headers promptly but stalls the JSON body: the whole verification still times out without a detached refresh (Task 1/3).
- Refresh rotates credentials successfully, then user verification fails temporarily: preserve completed rotation writes without allowing rendering or expiring a valid session (Task 2/3).
- SDK invalid-session cleanup attempts to remove a PKCE verifier: preserve the pending verifier and unrelated cookies while clearing only this project's session (Task 2/3).
- Several cookie callbacks include chunk removals and empty later metadata: the final response retains the final cookie state and earlier cache protections (Task 2).
- Dotted application routes, RSC/prefetch and normalized data URLs: session coverage remains consistent while known static/health routes bypass Auth (Task 2/3).

## File responsibilities

- `lib/supabase/proxy-auth.ts`: server-only, request-local Auth deadline/transport; no Next.js response ownership.
- `lib/supabase/proxy.ts`: real SDK client, verification outcome, incoming cookie view and outgoing response finalization.
- `proxy.ts`: named Proxy entry and literal matcher, without a runtime override.
- `tests/supabase-proxy.unit.mts`: focused transport/adapter/matcher verification. The `.unit.mts` suffix deliberately keeps server-only imports out of the ordinary browser-safe `*.test.mts` suite.
- `scripts/verify-supabase-proxy.mjs`: disposable Next.js app with the real Proxy, fictional Auth server and separate browser cookie jars.
- `package.json`, `.github/workflows/ci.yml`: separate Proxy verification commands in the existing app job.
- `docs/environment-configuration.md`, `docs/auth-callbacks.md`, `README.md`: actual refresh contract and remaining guard/callback work.

## Task 1: Bounded Auth transport

**Files:** Create `lib/supabase/proxy-auth.ts`, `tests/supabase-proxy.unit.mts`; modify `package.json`.

**Interfaces:** Produce `createProxyAuthTransport(): { fetch: typeof globalThis.fetch; isUnavailable(): boolean; close(): void }`. Export `AUTH_VERIFICATION_TIMEOUT_MS = 5000`. All controllers, deadline state and failure flags belong to one invocation.

- [ ] Read the installed Next.js Proxy guide and SDK `fetch.ts`, `_refreshAccessToken` and `_callRefreshToken` paths. Confirm refresh retries on network/5xx errors and non-retryable errors can trigger SDK cleanup. Use that evidence to implement the transport/outcome separation below; do not modify SDK internals.
- [ ] Write failing tests importing the missing transport. Use a loopback HTTP server and real fetch. Test names/assertions:

```ts
// "Auth transport preserves successful and credential-rejection responses"
assert.equal(success.status, 200);
assert.equal(rejection.status, 401);
assert.equal(transport.isUnavailable(), false);
// "Auth outages become a local terminal SDK response, not credential rejection"
assert.equal(outage.status, 400);
assert.equal((await outage.json()).error_code, "volo_auth_unavailable");
assert.equal(transport.isUnavailable(), true);
// "Deadline covers stalled response bodies and stops later requests"
assert.equal(AUTH_VERIFICATION_TIMEOUT_MS, 5000);
assert.ok(elapsedMs < 6500); // scheduling tolerance; not a larger production budget
assert.equal(callsAfterClose, callsAtClose);
```

  Cover HTTP 429, 500, an abruptly closed socket, never-arriving headers, headers followed by a stalled body, malformed JSON and structurally invalid successful Auth payloads. Await server socket closure/cleanup and restore any test environment. Never print headers or Auth bodies.
- [ ] Add `test:proxy:unit` as `node --conditions=react-server --test tests/supabase-proxy.unit.mts`. Run it; expected FAIL importing the missing transport.
- [ ] Implement the interface with `import 'server-only'`, a shared five-second deadline for all Auth requests in this operation, combined caller/deadline cancellation and buffered response bodies within the deadline. Preserve successful and genuine credential-rejection responses. A network/timeout/429/5xx failure records `isUnavailable() = true` and returns a synthetic local HTTP 400 JSON response with fixed `error_code: "volo_auth_unavailable"` and no upstream detail.

  Validate the buffered JSON before handing it to the SDK. Successful `/user` responses require a user object with a nonempty string ID (directly or under `user`); successful refresh-token responses additionally require nonempty access/refresh tokens and numeric expiry data. Malformed JSON or an invalid successful payload is an unavailable/protocol failure using the same local terminal response, so SDK JSON parsing cannot restart a retry loop or mistake a broken refresh response for rejected credentials.

  This local response is solely an SDK retry-control bridge, never a browser response or proof of invalid credentials. It makes SDK refresh terminate instead of retrying in the background. Task 2 must use the separate failure flag to return 503 and suppress outage-induced cleanup. After failure/closure, additional transport calls terminate locally without new network requests. `close()` cancels remaining work and clears the timer; it is called in a `finally` after verification settles. Do not use a naked `Promise.race` that leaves SDK refresh running.
- [ ] Run `npm run test:proxy:unit` and `npm run typecheck`. Expected: transport tests PASS, including actual five-second hang cases; strict TypeScript PASS. Commit `feat(VOLO-114): bound Proxy Auth verification transport`.

## Task 2: Request-scoped Proxy, cookie finalizer and matcher

**Files:** Create `lib/supabase/proxy.ts`, root `proxy.ts`; extend `tests/supabase-proxy.unit.mts`.

**Interfaces:** Consume Task 1's transport and existing `getSupabasePublicConfig()` / `Database`. Produce `refreshSupabaseSession(request: NextRequest): Promise<{ response: NextResponse; finalizeResponse(response: NextResponse): NextResponse }>`; root `proxy(request: NextRequest): Promise<NextResponse>` returns its `response`. Do not expose SDK clients or identity signals to consumers. Failure results return a 503 response and must not be replaced by a successful response; their finalizer rejects such replacement.

- [ ] Extend failing tests to import the missing helper/root entry. Use real `NextRequest`, `NextResponse`, SSR SDK and loopback Auth behavior. Exercise expired sessions, successful user verification, credential rejection and transport failure. Initial expected failure: missing helper/root imports.
- [ ] Add matcher tests with installed `unstable_doesProxyMatch`: include `/`, `/dashboard`, `/dashboard/report.csv`, `/auth/confirm`, `/login`, `/api/private`, `/api/health-extra`, RSC/prefetch headers and the normalized data URL for `/dashboard`; exclude `/_next/static/app.js`, `/_next/image`, `/api/health`, `/api/health/`, `/favicon.ico`, `/robots.txt`, `/sitemap.xml` and the exact five public files `/file.svg`, `/globe.svg`, `/next.svg`, `/vercel.svg`, `/window.svg`. Assert paths such as `/file.svg/private` remain matched. The root matcher is a literal negative pattern with exact boundaries, not a general file-extension bypass.
- [ ] Implement a fresh `createServerClient<Database>` using the configured public URL/key and Task 1's `global.fetch`. Recognize the configured SDK storage name `sb-${new URL(url).hostname.split('.')[0]}-auth-token` and numeric chunk suffixes; use the same name explicitly in the client's cookie options. An unrelated cookie or `-code-verifier` alone takes the anonymous fast path without any Auth call.
- [ ] Implement `getAll` from `request.cookies` and `setAll` with invocation-local accumulated updates keyed by cookie name. Apply non-deleted values to the incoming view and delete max-age-zero/expired values. Preserve the SDK's complete outgoing cookie options. Ignore updates for a PKCE verifier or unrelated cookie during invalid-session cleanup. If the transport failure flag is set, suppress that callback's cleanup writes; retain valid refresh updates completed before the failure flag was set.
- [ ] Call `auth.getUser()` and await it fully. A valid user permits pass-through; no session or recognized credential rejection clears only the project's session cookie/chunks and permits anonymous pass-through. Recognized rejection includes `AuthSessionMissingError` and credential codes `bad_jwt`, `session_not_found`, `refresh_token_not_found`, `refresh_token_already_used`, `user_not_found`, `user_banned`. An otherwise unexplained Auth error, invalid successful user payload or transport failure produces a generic HTTP 503, not anonymous success. Configuration/adapter exceptions propagate safely; do not catch all exceptions as credential rejection. Close the transport in `finally`.
- [ ] Construct the normal response through `NextResponse.next({ request: { headers: new Headers(request.headers) } })` after verification and incoming cookie updates. Apply SDK metadata and private policy to every session-bearing response and every 503: exact cache control `private, no-cache, no-store, must-revalidate, max-age=0`, `Expires: 0`, `Pragma: no-cache`. Empty later SDK metadata cannot erase earlier protections. No identity/session headers are added.
- [ ] Implement the response finalizer: apply accumulated cookies and the private cache policy onto a supplied response, preserving its unrelated headers/status/location. Never copy incoming/internal forwarding headers onto replacements. The returned default response is already finalized. Synthetic 303 redirects are tested without introducing application redirects.
- [ ] Pin behavior in focused tests:

```ts
assert.equal(authCallsForAnonymousOrVerifierOnly, 0);
assert.equal(updatedIncomingSession.user.id, fictionalUserA);
assert.equal(result.response.headers.get("cache-control"),
  "private, no-cache, no-store, must-revalidate, max-age=0");
assert.equal(redirect.status, 303);
assert.equal(redirect.headers.get("location"), expectedSameOriginDestination);
assert.equal(redirect.headers.get("x-middleware-request-cookie"), null);
assert.equal(outage.response.status, 503);
assert.equal(outageDeletesExistingSession, false);
assert.equal(pkceVerifierAfterInvalidCleanup, originalVerifier);
```

  Also test rotated tokens followed by user-service failure, all chunk options/removals, multiple callbacks and earlier cache metadata, foreign/forged identity headers, preserved unrelated response headers, scoped cleanup and a throwing response cookie writer. Observe persistence failure through the operation/finalizer rather than only a callback count.
- [ ] Run `npm run test:proxy:unit`, `npm run typecheck`, `npm run lint` and `git diff --check`. Expected: all focused tests PASS, no type/lint/diff errors. Commit `feat(VOLO-114): refresh sessions through request-scoped Proxy`.

## Task 3: Real Next.js refresh integration, documentation and PR

**Files:** Create `scripts/verify-supabase-proxy.mjs`; modify `package.json`, `.github/workflows/ci.yml`, `docs/environment-configuration.md`, `docs/auth-callbacks.md`, `README.md`; adjust boundary verification only if needed to include the new server-only Proxy modules.

**Interfaces:** Consume Task 2's real root Proxy, helper and finalizer. Produce standalone `npm run test:proxy` which runs the focused unit command followed by the integration script, exiting nonzero on any failure. CI runs it after ordinary smoke/client checks.

- [ ] Write the failing real Next.js integration fixture before any fixture-specific repair. Follow `scripts/verify-supabase-clients.mjs` for isolated temp app, copied real modules, symlinked dependencies, sanitized env and bounded process cleanup. Copy the real root Proxy. Use only a loopback Auth stub supporting fictional `/auth/v1/user`, password-grant seeding and refresh-token exchange. Deny/record every unexpected outbound request and route.
- [ ] A fixture-only seeding Route Handler uses the real server SDK to establish a session from the stub's fictional password-grant response, including an already-expired session where requested. This exercises the SDK cookie format instead of copying its serialization implementation. Seed each scenario with a fresh jar. The normal page reads the real server factory in read-only mode; a fixture protected endpoint independently verifies identity; a fixture redirect uses the real finalizer. No production seeding/protected/redirect routes or real accounts are added.
- [ ] Verify refresh persistence and user isolation:

```js
assert.equal(firstPage.status, 200);
assert.equal(userSeenByServerComponentOnRefreshRequest, fictionalUserA);
assert.equal(refreshCallsAfterFollowingRequest, refreshCallsAfterFirstRequest);
assert.equal(userSeenBySecondJar, fictionalUserB);
assert.ok(largeSessionCookies.length > 1);
assert.ok(obsoleteChunks.every(cookie => cookie.maxAge === 0));
```

  Run two users concurrently; replace large sessions with small ones; verify path, same-site, expiry and deletions in actual HTTP Set-Cookie. Use short fictional metadata below Node's response-header limit while still exercising multiple SDK chunks.
- [ ] Verify anonymous, PKCE-only, invalid-cookie, revoked-user and rejected-refresh cases. The fixture protected endpoint returns 401 for anonymous/invalid sessions and never emits its private marker. Public auth pages remain reachable without redirects. A dotted fixture application route and HTML/RSC/prefetch requests receive consistent handling. Health/static requests work while Auth is unavailable with zero Auth calls.
- [ ] Verify 429/5xx/network/hanging-header/hanging-body failures finish within 6500 ms for the production five-second budget, return generic uncacheable 503 and do not render private content or expire valid browser credentials. Verify successful rotation before a subsequent failure still reaches the browser. Wait for cancellation/socket completion and assert no further Auth requests, cookie writes or unhandled rejections after finalization. Failure must come from the actual SDK/transport path, not a preconstructed fake result.
- [ ] Verify the synthetic redirect preserves all session cookies/cache headers and its own status/location/header. Scan browser assets, HTML, RSC, JSON, visible response headers and captured process output for synthetic token/refresh/private canaries, permitting only intended Set-Cookie. Include the client import prohibition for server-only Proxy modules in disposable boundary builds. Run the new fixture; expected PASS for each named category. If it fails, diagnose the actual contract before changing code.
- [ ] Add `test:proxy` as `npm run test:proxy:unit && node scripts/verify-supabase-proxy.mjs` and the CI step. Document imports, matcher exclusions/maintenance, anonymous fast path, getUser/network trade-off, five-second transport policy and local terminal bridge, invalid versus transient outcomes, cache policy and replacement finalization. Update the stale callback doc's statement that no SDK/session flow exists; retain pending callback/hosted activation and VOLO-115/116/118 scope.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`, `npm run test:clients`, `npm run test:boundaries`, `npm run test:proxy` and `git diff --check`. Expected: all PASS. Use bundled Node/npm on this host; the documented local `next build --webpack` substitute is permitted, while hosted CI validates the default bundler. Fixture builds remain webpack and do not load real `.env` files.
- [ ] Commit `test(VOLO-114): verify Proxy refresh and document auth handoff`. Request one fresh whole-branch review using the approved execution workflow; fix material findings with failing regression tests. Push `feature/volo-114-session-refresh`, create and attach the implementation PR, and wait for default-bundler app CI, database/access-policy CI and Netlify Deploy Preview.
- [ ] Run `SMOKE_BASE_URL=https://deploy-preview-<PR-number>--voloapp.netlify.app npm test`, verify homepage/dashboard navigation and refresh in the browser, and record commit/CI/deploy/test evidence in VOLO-114. Expected: all public checks PASS. Do not perform hosted session mutations, activate callback URLs or publish production. Keep VOLO-114 In Progress until the implementation merges.

## Execution recommendation

Native execution: one implementer handles the three tightly connected transport,
adapter and fixture tasks, followed by one fresh whole-branch review. This keeps
deadline and cookie ownership consistent without paying for repeated per-task
implementer/reviewer contexts. The plan must be reviewed before product code starts.
