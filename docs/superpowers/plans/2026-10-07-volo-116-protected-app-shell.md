# Protected App Shell Implementation Plan

Preview verification amendment: use fixed `/login?reason=authentication-required`
to suppress Netlify's incoming query propagation. This supersedes parameterless
redirect examples and the empty-query assertion below. Assert exact HTTP,
streamed HTML and RSC destinations, including attempts to override `reason`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect dashboard content with fresh identity and active-membership checks, providing a public `/login` destination and safe failure states.

**Architecture:** A server-only page-access adapter translates the existing fresh access result into a fixed login redirect or a typed rendering decision. The dashboard renders its server shell and overview only after authorization; a presentational route-group layout never grants access. Disposable Next fixtures exercise real product modules and Proxy with fictional services.

**Tech Stack:** Next.js 16.3.8 App Router, React 19.2.8, strict TypeScript, Node.js 24, Supabase SSR 0.12.7 / JS 2.117.2, existing Node/Next integration fixtures.

**Spec:** `docs/superpowers/specs/2026-10-07-volo-116-protected-app-shell-design.md` (approved).

## Global Constraints

- Use `feature/` branches, Netlify Deploy Previews and production only. There is no staging environment. Production automatic publishing stays locked; merging does not constitute a production release.
- Hosted previews share Supabase with production: all authentication and membership write fixtures remain local and fictional.
- Retain the top-level root layout. The route group does not alter `/dashboard`.
- Every protected page must independently await a shared server-only page-access helper backed by VOLO-115 before constructing protected output.
- No React/Next/module-level authorization cache, full user/client props, credential disclosure, new dependencies, schema changes or production test endpoints.
- Fixed `/login` redirect; no copied query, `next` destination or token forwarding. Login/logout and callback implementation remain outside this ticket.
- Existing Proxy cookie rotation, outage response and response finalization remain intact. Verify private/no-store for this ticket's responses; the wider cache audit remains VOLO-118.
- Read relevant installed `node_modules/next/dist/docs/` guides before code; use the established feature-checkout isolation fallback if managed worktrees require out-of-root writes.

## Review Focus

- A retained layout or targeted RSC navigation must not allow a nested page to bypass its own fresh decision (Task 1).
- Query strings resembling external return URLs must never change `/login` or leak into the redirect (Task 1).
- A refreshed session followed by membership denial must preserve rotated cookies without exposing protected output (Task 1).
- Anonymous denial, prefetch variants and unknown nested paths must retain correct private caching and 404 behavior (Tasks 1/2).
- A service outage must not be converted into missing membership, erase credentials, leak raw diagnostics or suppress Next redirect control flow (Task 1).

## File Responsibilities

- `lib/auth/page-access.ts`: server-only page adapter; fresh access call and fixed login redirect.
- `app/(protected)/layout.tsx`: presentational shared container and explicit dynamic rendering configuration; no identity or authorization reads.
- `app/(protected)/_components/app-shell.tsx`: server-rendered Volo navigation and authorized content container.
- `app/(protected)/_components/access-state.tsx`: generic forbidden/unavailable UI, home and fixed dashboard retry links.
- `app/(protected)/dashboard/page.tsx`: move existing dashboard, enforce page access, render safe state or shell/overview.
- `app/login/page.tsx`: public placeholder and home link, without authentication actions.
- `scripts/verify-protected-app.mjs`: isolated Next production fixture, actual product route/helper copies, controllable backend, HTML/RSC/cache/cookie/leak assertions and cleanup.
- `tests/helpers/access-fixture.mjs`: reuse existing fictional accounts/services; extend only if a tested scenario needs an additional service mode.
- `tests/smoke.test.mjs`: current anonymous login/dashboard behavior and public route/404 checks.
- `scripts/verify-supabase-boundaries.mjs`: compiled Client Component rejection for the new page-access module.
- `package.json`, `.github/workflows/ci.yml`: protected-app command and CI integration.
- `README.md`, `docs/environment-configuration.md`, `docs/preview-verification.md`, `docs/auth-callbacks.md`: current page contract, commands and login handoff; retain historical evidence.

## Task 1: Protected dashboard, page adapter and real request verification

**Files:** Create page adapter, protected layout/components/dashboard, login page and verification script above; remove old `app/dashboard/page.tsx` by moving it. Modify `package.json`, `tests/smoke.test.mjs`; extend `tests/helpers/access-fixture.mjs` only as needed.

**Interfaces:** Consume `getAccess(): Promise<AccessResult>` and `ActiveMember` from `lib/auth/access.ts` unchanged. Export `PageAccessResult = {status:"authorized";member:ActiveMember} | {status:"forbidden"|"unavailable"}` and `getPageAccess(): Promise<PageAccessResult>` from `lib/auth/page-access.ts`. Export default `AppShell({children}:{children:React.ReactNode})` and `AccessState({status}:{status:"forbidden"|"unavailable"})`. Neither accepts session/client/user objects. Use `/dashboard` as the unavailable retry destination. Export `dynamic = "force-dynamic"` from the group layout; no cache components or experimental auth interrupts.

- [ ] Read current access/server/Proxy modules, existing fixture scripts and installed authentication, route-groups, redirect, not-found and CDN caching guides. Confirm layout-independent rendering and canonical `_rsc` redirect behavior before fixing test expectations.
- [ ] Create `verify-protected-app.mjs` with temporary directory, sanitized fictional env, symlinked dependencies, copied actual `lib`, root Proxy, protected route files and public login. Use a minimal fixture root layout to avoid external font downloads, fixture public home/health/callback pages and a fixture-only nested `/dashboard/nested` page that calls the real `getPageAccess` before a private marker. Reuse `startAccessFixture`, SDK seed jars and loopback outbound restrictions. Build with webpack, start on a reserved loopback port, bound child processes and close server/backend/delete only the owned temporary directory in `finally`.
- [ ] Write the initial `anonymous dashboard cannot emit protected content` and `public login exists without redirect loops` assertions before product code. Add `test:protected-app` as `node scripts/verify-protected-app.mjs`; run it. Expected RED: required product module/route missing, or the current public dashboard reveals its overview.

```js
assert.equal(new URL(redirectLocation, origin).pathname, "/login");
assert.equal(new URL(redirectLocation, origin).search, "");
assert.doesNotMatch(deniedBody, /Workspace overview|fixture-private-nested/);
assert.match(loginBody, /Sign-in is not available yet/);
```

- [ ] Implement `getPageAccess` with `import "server-only"`, one awaited fresh `getAccess`, fixed `redirect('/login')` for unauthenticated and the other typed results returned unchanged. Unexpected errors propagate. Do not wrap the redirect in a catch, cache the result or add Proxy authorization.
- [ ] Move the dashboard into the protected group. Await the helper before constructing workspace output. For authorized users render `AppShell` with Volo name, dashboard/home navigation, existing dashboard heading and overview; no identity display, menu or logout controls. Disable speculative prefetch on protected dashboard navigation. For forbidden/unavailable render `AccessState` without the authenticated shell. Use exact titles “Access denied” and “Unable to verify access”; generic explanatory copy, home link and unavailable-only `/dashboard` retry link. The group layout shares existing container styling and explicitly forces dynamic rendering; it does not read access or wrap protected content in Suspense/loading UI.
- [ ] Add `app/login/page.tsx`: “Sign in” heading, “Sign-in is not available yet” message, home link and static metadata. No form, cookie mutation or session-based redirect. Run the initial fixture assertions to GREEN.
- [ ] Extend fixture tests `active member and admin render the workspace`, `membership denial and outages reveal no workspace`, and `membership changes recheck an unchanged session`. Assert both legitimate roles succeed; absent/disabled membership fails; metadata spoofing cannot authorize; forbidden/unavailable UI contains no overview/private marker; retry rechecks after recovery; concurrent different users remain independent. Test forged/revoked credentials and raw backend error canaries. Inspect backend requests to prove each independent page request makes a new membership query.
- [ ] Add `HTML RSC and prefetch variants enforce page boundaries`: run direct/repeated documents, RSC full payload, prefetch headers and targeted router-state requests for dashboard and fixture nested page. Use installed route-group tree conventions in the targeted state; follow only same-origin canonical `_rsc` redirects while retaining headers/cookies. Distinguish Next login redirect instructions from canonical hash redirects. Assert no private marker in any denied variant; assert full authorized nested RSC includes its private marker and a fresh membership request, so absence is not a vacuous test of an omitted segment.
- [ ] Add `login destination ignores untrusted return parameters`: request dashboard with `next=https://example.invalid`, `next=//example.invalid`, encoded external paths and synthetic token-looking query canaries. Assert fixed `/login`, empty redirect query and no canary forwarded. Test no-Proxy fixture page requests separately if needed to prove the helper is the boundary.
- [ ] Add `rotation survives protected page denial`: seed expired fictional sessions, absorb actual SDK cookie chunks after Proxy refresh and verify authorized rendering or membership-denied UI as appropriate. Assert refresh cookies survive, no secrets appear outside intended Set-Cookie storage, and membership denial does not erase a valid session. Test Auth outage HTTP 503 and membership outage safe UI; keep generic diagnostics and bounded completion, with no outage-induced credential deletion.
- [ ] Assert protected authorized/denied HTML and full RSC cache-control include `private` and `no-store`, including cookie-less requests and redirect responses. Prefetch must contain no protected data on denial; assert private/no-store on any variant carrying identity-dependent output. Only if installed response behavior fails the required policy, apply narrowly scoped headers through the existing response-owning Proxy flow without replacing its cookie finalizer or authorizing unknown routes; add a regression for that failure before the change.
- [ ] Update ordinary smoke tests: homepage retains dashboard link, login renders placeholder, anonymous dashboard redirects to `/login` without overview, repeat/query requests behave consistently, anonymous RSC never contains overview, health methods remain unchanged and unknown nested/API paths remain 404. Run these against a rebuilt local production app with fictional config, allowing canonical RSC redirects but never silently following a login redirect without asserting the original denial.
- [ ] Run `npm run test:protected-app`, `npm run typecheck`, `npm run lint`, `next build --webpack`, `npm test`, `git diff --check`. Expected all named categories PASS and no server errors/credential canaries. Commit `feat(VOLO-116): protect dashboard and establish login destination`.

## Task 2: Server boundaries, CI, handoff and verified PR

**Files:** Modify boundary script, CI, README and the four current-behavior docs listed above. Product interfaces from Task 1 remain unchanged.

**Interfaces:** CI runs `npm run test:protected-app` after `test:access`; ordinary `npm test` reflects the new public/login/protected route contract. VOLO-22 consumes fixed `/login` and later replaces the placeholder; it does not inherit a return-URL feature.

- [ ] Add a failing disposable Client Component import build for `lib/auth/page-access`, asserting the installed server-only compiler diagnostic. Keep existing negative builds and browser/HTML/RSC/JSON credential-canary scans. Run `npm run test:boundaries`; expected rejection of all forbidden imports and PASS for leak checks.
- [ ] Add the protected-app CI step. Update README command/current behavior, environment page-guard/cache contract, preview HTTP/browser checklist and auth handoff `/login` contract. Keep historical deployment observations dated and intact. Describe Next streamed failure/redirect semantics and the limitation that already delivered browser content cannot be retracted. Keep full auth, wider caching and mutation tickets separately scoped.
- [ ] Add fixture public-route/404 assertions with anonymous and active-member jars: homepage, login, health and fixture `/auth/confirm` remain reachable; `/dashboard/missing` and `/api/missing` remain 404 without redirect or protected marker. Verify the real product smoke suite independently, including unknown nested paths, so fixture routing cannot conceal a regression.
- [ ] Run typecheck, lint, production webpack build, regular smoke tests, `test:clients`, `test:proxy`, `test:access`, `test:protected-app`, `test:boundaries`, and `git diff --check`. Use bundled Node/npm and fictional config on this host; hosted CI uses the default production bundler and independently runs database policy checks. Expected all PASS. Commit `test(VOLO-116): verify protected navigation and document login handoff`.
- [ ] Obtain the chosen workflow's fresh whole-branch review and address material findings with failing regressions and a green relevant suite. Push `feature/volo-116-protected-app-shell`, create and attach the PR; wait for app/database CI and the exact-head Netlify Deploy Preview. Production publishing stays locked.
- [ ] Run `SMOKE_BASE_URL=https://deploy-preview-<PR-number>--voloapp.netlify.app npm test`; browser-check public home → dashboard → login, direct dashboard access and refresh, home navigation and login placeholder. Only read-only anonymous hosted checks; authenticated service/write fixtures stay local. Record head, CI run, deploy URL and evidence in VOLO-116; add the agreed `/login` handoff to VOLO-22. Leave VOLO-116 In Progress until verified merge.

## Execution Recommendation

Native: the two tasks share the page adapter, route tree and real-request fixture.
One implementer can keep those contracts consistent, with one fresh whole-branch
review before publishing the PR. Subagent-driven execution is also available if
independent review after each task is preferred.
