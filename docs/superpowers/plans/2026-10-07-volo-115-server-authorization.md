# Verified Server Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supply fresh, verified identity and active-membership checks for protected server reads and mutations.

**Architecture:** A server-only access module constructs a fresh read-only Supabase client per invocation, verifies through getUser, and queries only the verified subject's membership through RLS. Caller-owned Auth and membership transports bound service failures; structured results and typed guards leave redirects and HTTP responses to consumers.

**Tech Stack:** Next.js 16.3.8 App Router, Node.js 24, strict TypeScript, Supabase SSR 0.12.7 / JS 2.117.2, generated Database, Node tests and disposable Next fixtures.

**Spec:** `docs/superpowers/specs/2026-10-07-volo-115-server-authorization-design.md` (approved).

## Global Constraints

- Next.js 16.3.8 App Router, strict TypeScript, the installed Supabase SSR/JS SDKs and generated Database types.
- Use feature/ branches, Netlify Deploy Previews and production only. Production publishing stays locked.
- Preview shares hosted Supabase; all account and membership write tests use disposable local fixtures. No hosted credentials, email, account mutations or database writes.
- No schema migration, service-role client, membership write, login/callback flow, dashboard protection or production release. Those remain the follow-up tickets identified in the spec.
- No React/Next/module-level authorization cache. Every guard independently verifies identity and reads current membership.
- Preserve the existing server factory's cookie ownership contracts and Proxy behavior. Never return a client, token, full user, metadata or raw upstream error.
- Auth and membership phases each have a five-second deadline including response bodies. Cleanup completes before returning; no naked Promise.race or detached retries.

## Review Focus

- A verified Auth subject differs from cookie metadata or a returned membership row: only the verified subject may select membership, and mismatched rows cannot authorize (Task 2).
- Unknown Auth rejection and malformed/failed PostgREST results must fail unavailable rather than granting access or pretending membership is absent (Tasks 1/2).
- Status and role changes with an unchanged JWT, concurrent users and repeated checks in one render must not reuse stale authorization (Task 2).
- Direct calls without Proxy, including expired sessions and stalled bodies, must finish safely without cookie writes, leaked SDK diagnostics or detached retries (Tasks 1/2).
- A role guard must recheck membership rather than accept a previously returned access object; invalid/empty role inputs cannot grant access (Task 2).

## File Responsibilities

- `lib/auth/membership-transport.ts`: bounded JSON-consuming PostgREST fetch; no Auth response validation or Next response ownership.
- `lib/supabase/server.ts`: optional caller-owned fetch override, preserving existing factory defaults and cookie contracts.
- `lib/auth/access.ts`: result/error types, fresh identity/membership lookup and active-member/role guards.
- `tests/auth-transport.unit.mts`: real HTTP membership transport tests under react-server conditions.
- `tests/helpers/access-fixture.mjs`: fictional UUID sessions and controllable loopback Auth/PostgREST service; no hosted access.
- `scripts/verify-server-access.mjs`: disposable Next fixture exercising real access functions and server client through request cookies.
- `scripts/verify-supabase-clients.mjs`: verify optional factory fetch override without changing default-client behavior.
- `scripts/verify-supabase-boundaries.mjs`: compiled Client Component prohibition for both new server-only modules.
- `package.json`, `.github/workflows/ci.yml`, `README.md`, `docs/environment-configuration.md`: commands, CI and actual consumer contract.

## Task 1: Bounded membership transport and caller-owned client fetch

**Files:** Create `lib/auth/membership-transport.ts`, `tests/auth-transport.unit.mts`; modify `lib/supabase/server.ts`, `scripts/verify-supabase-clients.mjs`, `package.json`.

**Interfaces:** Export `MEMBERSHIP_TIMEOUT_MS = 5000` and `createMembershipTransport(): { fetch: typeof globalThis.fetch; isUnavailable(): boolean; close(): void }`. Extend both existing server-client option variants with optional `fetch?: typeof globalThis.fetch`; existing cookieMode and setResponseHeaders requirements remain identical. Pass the override only to that constructed client's `global.fetch`.

- [ ] Read installed Next authentication/data-security guides, current server factory and the installed PostgREST builder/retry implementation. Note that PostgREST retries default to enabled; Task 2 explicitly disables them on the membership query.
- [ ] Write `tests/auth-transport.unit.mts` before the transport exists. Tests use real loopback HTTP, import the server-only module with react-server conditions, restore state and close sockets. Name the behavior "membership transport bounds bodies, sanitizes failures and cancels later work" with these assertions:

```ts
assert.equal(MEMBERSHIP_TIMEOUT_MS, 5000);
assert.deepEqual(await success.json(), [{user_id: subject, role: "member", status: "active"}]);
assert.equal(transport.isUnavailable(), false);
assert.equal(failure.status, 400); // local terminal bridge, never a browser response
assert.equal(transport.isUnavailable(), true);
assert.ok(elapsedMs < 6500);
assert.equal(callsAfterClose, callsAtClose);
```

  Cover empty successful arrays, error statuses including 401/403/429/500, disconnected socket, invalid JSON, stalled headers and stalled body. Verify raw response/error canaries are absent from the returned failure. Separate transports remain independent; a transport created before a slow Auth phase gets its full budget when its own first fetch begins.
- [ ] Add `test:access:unit` as `node --conditions=react-server --test tests/auth-transport.unit.mts`; run it. Expected: FAIL importing missing membership transport.
- [ ] Implement the interface with server-only marker, lazy per-instance deadline starting on first fetch, combined caller/deadline abort and buffered JSON body before returning. Preserve normal successful response semantics for SDK parsing; validate row structure in Task 2. On non-2xx/network/timeout/malformed JSON, mark unavailable and return fixed HTTP 400 JSON `{message:"Membership service unavailable."}` without upstream details. Subsequent calls after failure/close terminate locally; close aborts and clears the timer. Do not patch global fetch or SDK internals.
- [ ] Add a fixture-only Next Route Handler assertion to `verify-supabase-clients.mjs` that supplies an override, constructs the real factory and observes only that client's Auth fetch reaching it. Expected RED: existing factory ignores the supplied override. Keep existing default-client/concurrency/cookie tests intact.
- [ ] Extend factory options with optional fetch and forward it to `global.fetch` without mutating global defaults. Preserve mode validation and writable header-sink validation.
- [ ] Run `npm run test:access:unit`, `npm run test:clients`, `npm run typecheck`, `npm run lint`, `git diff --check`. Expected: all PASS, including both real five-second hang tests and override isolation. Commit `feat(VOLO-115): bound membership lookup and support scoped fetch`.

## Task 2: Verified access results and fresh role guards

**Files:** Create `lib/auth/access.ts`, `tests/helpers/access-fixture.mjs`, `scripts/verify-server-access.mjs`; modify `package.json`.

**Interfaces:** Consume Task 1's fetch option and membership transport plus existing `createProxyAuthTransport`, `AUTH_CREDENTIAL_CODES`, `getSupabasePublicConfig`, Database and server factory. Export `MemberRole = Database["public"]["Enums"]["member_role"]`, readonly `ActiveMember = { userId: string; role: MemberRole }`, `AccessFailure = "unauthenticated" | "forbidden" | "unavailable"`, and `AccessResult = {status:"authorized"; member:ActiveMember} | {status:AccessFailure}`. Export `AccessError extends Error` with readonly code:AccessFailure and fixed generic messages, `getAccess(): Promise<AccessResult>`, `requireActiveMember(): Promise<ActiveMember>`, `requireRole(allowedRoles: readonly MemberRole[]): Promise<ActiveMember>`.

- [ ] Build a disposable Next fixture following `verify-supabase-clients.mjs`: temporary app, copied real lib/tsconfig, symlink dependencies, sanitized fictional env, webpack build and bounded child/socket cleanup. Do not load checkout .env files. A separate helper owns controllable loopback Auth/PostgREST responses and SDK-generated cookie jars with valid fictional UUID subjects. Record unexpected requests and prohibit outbound origins. Keep the existing Proxy fixture unchanged.
- [ ] Add fixture-only result, active-member and role API endpoints and a Server Component invoking real guards. Explicitly return private no-store fixture responses, map AccessError codes to 401/403/503, return only safe member fields on success, and no private marker on denial. Do not copy root Proxy: this fixture proves independent checks. Seed fictional jars using SDK password-grant responses outside product code; never invent production auth endpoints.
- [ ] Write assertions for anonymous/malformed cookies and recognized invalid or forged credentials producing unauthenticated/401 with zero membership requests; active member/admin success; absent/disabled membership and role denial producing forbidden/403; role metadata spoofing having no effect. Assert exact safe result fields, read-only cookies, membership select/filter and caller bearer, and differing verified versus cookie-embedded identities. Run the fixture. Expected: FAIL because access module does not exist.

```js
assert.deepEqual(await active.json(), {userId: memberId, role: "member"});
assert.equal(denied.status, 403);
assert.equal(unauthenticated.status, 401);
assert.equal(unavailable.status, 503);
assert.equal(membershipCallsWithoutVerifiedUser, 0);
assert.equal(response.headers.getSetCookie().length, 0);
assert.equal(query.searchParams.get("user_id"), `eq.${verifiedId}`);
assert.equal(query.searchParams.get("select"), "user_id,role,status");
```

- [ ] Implement getAccess with a fresh read-only factory client and caller-local fetch dispatch: exact configured Auth paths use existing Auth transport; exact `/rest/v1/memberships` uses Task 1 transport; unexpected outbound routes fail closed. Avoid mutating global fetch. Close the Auth transport after getUser settles so its timer cannot expire during the independent membership phase; always close both transports in finally. Any unexpected later Auth fetch terminates locally through the closed transport and prevents authorization. Inspect transport failure flags before treating SDK errors as credentials and again before authorizing.
- [ ] Await getUser, classify missing session/known credential errors as unauthenticated, unknown service/protocol errors as unavailable, and validate a nonempty canonical UUID subject before any query. Do not return the user or trust its metadata. Use the same client for `.from("memberships").select("user_id,role,status").eq("user_id", verifiedId).retry(false).maybeSingle()`; verify installed builder ordering. Disable request caching for both service transports. Query errors/failure flags/invalid rows are unavailable; null row or disabled is forbidden; only active valid member/admin with matching subject is authorized. Unexpected programming/configuration errors propagate without raw upstream logging.
- [ ] Implement guards using fresh getAccess each time. Fixed AccessError messages: `Authentication required.`, `Access denied.`, `Access service unavailable.`. requireRole accepts only a nonempty runtime array of valid enum values and explicitly matches current role; invalid/empty requirements deny and cannot override an identity/service failure. Do not accept an ActiveMember object as a shortcut, add caches or write cookies/membership.
- [ ] Extend fixture coverage: same JWT with status/role changed between independent calls; repeated guards in one render; concurrent users; explicit admin/member/empty/invalid role arrays; mismatched user_id, bad enum, duplicate rows and structurally invalid success; invalid successful Auth UUID. Assert new membership reads and no cross-user state.
- [ ] Exercise Auth and PostgREST 429/5xx/unknown errors, socket closure, malformed JSON, hanging headers/bodies and direct expired-session refresh without Proxy. Expected: safe denial/unavailable, each hanging phase <6500ms, zero outgoing cookie writes, no raw token/error canaries or detached requests after completion. Malformed membership JSON/query errors must never be classified as absent membership. Capture SDK output and scan browser assets, HTML/RSC/JSON and visible headers; fixture cookie setup is the only intended token storage.
- [ ] Add `test:access` as `npm run test:access:unit && node scripts/verify-server-access.mjs`. Run it, `npm run typecheck`, `npm run lint`, `git diff --check`. Expected: all named categories PASS. Commit `feat(VOLO-115): enforce verified identity and active membership`.

## Task 3: Boundary checks, consumer handoff and verified PR

**Files:** Modify `scripts/verify-supabase-boundaries.mjs`, `.github/workflows/ci.yml`, `README.md`, `docs/environment-configuration.md`.

**Interfaces:** Consume Task 2 exports unchanged; CI runs `npm run test:access` alongside existing client/Proxy checks. Docs identify import path, result/guard contracts, role behavior and current-membership freshness.

- [ ] Add failing disposable Client Component import builds for `lib/auth/access` and `lib/auth/membership-transport`. Assert the server-only compiler diagnostic as in existing boundary cases; preserve secret-canary scans and all existing checks. Run `npm run test:boundaries`; expected all negative builds rejected and browser/private leak assertions PASS.
- [ ] Add authorization verification to the app CI job after Proxy checks. Update README commands and environment/auth handoff docs: independent fresh checks, minimal data, no role metadata trust, no membership creation, fixed failure codes and 401/403/503 mappings, separate service deadlines, optional caller-owned factory fetch, no cookie persistence, no caching, authorization-at-lookup limitation and remaining VOLO-116/117/118 responsibilities. Keep dashboard public and production publishing locked.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`, `npm run test:clients`, `npm run test:proxy`, `npm run test:access`, `npm run test:boundaries`, `git diff --check`. Expected all PASS. On this host use bundled Node/npm, fictional config and the established local `next build --webpack` substitute; hosted CI uses default bundler. Database policy CI must also pass; HTTP stubs are not RLS verification.
- [ ] Commit `test(VOLO-115): verify authorization boundaries and document consumers`. Request one fresh whole-branch review under the chosen execution workflow; fix material findings with failing regression tests and a green suite. Push `feature/volo-115-server-authorization`, create/attach the PR, wait for app/database CI and Netlify Deploy Preview.
- [ ] Run `SMOKE_BASE_URL=https://deploy-preview-<PR-number>--voloapp.netlify.app npm test` and browser homepage/dashboard navigation and refresh. Expected 14 regular tests PASS and public behavior unchanged. Record tested feature commit, CI run, deploy and test evidence in VOLO-115. No hosted auth/account/membership writes or production publishing. Keep ticket In Progress until verified merge.

## Execution Recommendation

Native execution: the three tasks share transport ownership, SDK behavior and
fixture contracts. One implementer avoids repeated context setup; one fresh
whole-branch reviewer checks the security boundary before the PR is published.
