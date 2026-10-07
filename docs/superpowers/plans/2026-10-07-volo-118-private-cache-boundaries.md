# Private Content and Session Cache Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent shared caching of protected content and session-bearing responses while preserving unrelated public/static caching.

**Architecture:** One server-only header policy serves Proxy finalization, response-owned SDK cookie writes and JSON mutation responses. Production-built disposable Next fixtures prove request isolation and exercise a small shared-cache policy model; actual browser checks characterize client history separately. Netlify preview evidence remains anonymous.

**Tech Stack:** Next.js 16.3.8 App Router, strict TypeScript, Supabase SSR 0.12.7, Node 24 tests and existing browser tools; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-07-volo-118-private-cache-boundaries-design.md` (approved).

## Global Constraints

- Use `feature/volo-118-private-cache-boundaries`, forked from main `439ae4eefb614891d7f02e9acd6a333dc9e8cb62`. Preserve the established current-checkout sandbox fallback.
- Deploy Previews and production only; no staging environment. Production publishing remains locked; no production release is authorized.
- Hosted previews share production Supabase. Authenticated tests and writes use only fictional loopback services; hosted verification is anonymous and read-only. No synthetic hosted session cookies.
- Read installed Next guides before code: CDN caching, caching without Cache Components, cookies, headers, prefetching and staleTimes. Inspect installed/runtime behavior where adapters rewrite headers.
- No new dependency, schema change, privileged client, product endpoint, auth form, custom product cache, global polling, Cache Components or experimental staleTimes change.
- Preserve request-scoped authorization, no-store Auth/membership reads, strict mutation origin/input/effect contracts and `/login?reason=authentication-required`.
- Keep all test-only sessions, controls and cache model disposable. Never load real .env credentials into fixtures; prohibit outbound fetch beyond owned loopback services and clean up owned resources.
- Preserve public anonymous home/login caching and excluded static/image/health paths. Preserve cookie ownership, multiple Set-Cookie fields and SDK sink-error visibility.

## Review Focus

- An earlier public Netlify-specific directive must not override browser no-store after finalization; pin conflicting headers in Tasks 1/2/3.
- Cookie establishment without an incoming session must receive CDN protection before cookies persist; pin real SDK response sink behavior in Task 2.
- Anonymous protected redirects and RSC negotiation responses must not become cacheable entries; pin same-URL variants and redirect hops in Tasks 2/3/4.
- Successful private output followed by a backend outage or membership disablement must not become a stale fallback; pin warmed same-URL sequences in Task 3.
- Back/forward restoring already-delivered client state must not be reported as a fresh server authorization or confused with a shared-cache replay; record server call counts and browser observations in Tasks 3/4.

## Files and responsibilities

| File | Responsibility |
| --- | --- |
| `lib/http/private-response.ts` | Server-only common cache header mutation |
| `lib/http/protected-path.ts` | Server-only explicit protected page path classification |
| `lib/supabase/proxy.ts` | Finalizer applies common policy after cookie/metadata preservation |
| `lib/supabase/server.ts` | Writable SDK header sink receives common policy before cookie writes |
| `lib/auth/route-mutation.ts` | All adapter-created JSON responses use common policy |
| `tests/private-response.unit.mts` | Header/preservation/idempotence/path policy tests |
| `tests/supabase-proxy.unit.mts`, existing client/Proxy/protected/mutation verification scripts | Integration assertions at existing response owners |
| `tests/helpers/shared-cache.mjs`, `tests/shared-cache.test.mjs` | Disposable policy model and positive/negative controls |
| `tests/helpers/cache-fixture.mjs` | Production Next fixture with real guards, fictional subjects and visible browser controls |
| `scripts/verify-private-cache.mjs` | Same-URL integration assertions and optional retained local browser session |
| `scripts/verify-supabase-boundaries.mjs` | Compiled client-import denials for both new server-only modules |
| `tests/smoke.test.mjs`, `scripts/verify-preview-cache.mjs` | Anonymous hosted policy/cache-status evidence |
| `package.json`, `.github/workflows/ci.yml` | Unit/integration cache command and CI gate |
| README and environment/preview/auth handoff docs | Contract, browser observations, local/hosted evidence and limitations |

### Task 1: Define the shared response and protected-path policy

**Files:** Create `lib/http/private-response.ts`, `lib/http/protected-path.ts`, `tests/private-response.unit.mts`; add unit command to package.json.

**Interfaces:**
- Produces `applyPrivateResponseHeaders(headers:Headers):void`. Mutate only five fields by replacement: Cache-Control `private, no-cache, no-store, must-revalidate, max-age=0`; CDN-Cache-Control `no-store`; Netlify-CDN-Cache-Control `no-store`; Expires `0`; Pragma `no-cache`.
- Produces `isProtectedPagePath(pathname:string):boolean`: true for `/dashboard` or `/dashboard/` descendants only. Caller supplies Next's parsed pathname; no URL/query parsing or authorization inside this classifier.
- Produces `test:cache:unit = node --conditions=react-server --test tests/private-response.unit.mts`.

- [ ] Write `private policy replaces every conflicting cache field and preserves response metadata` and `protected roots match complete segments` with these pinned assertions:

```ts
const headers = new Headers({
  'Cache-Control':'public, s-maxage=600, stale-while-revalidate=60',
  'CDN-Cache-Control':'public, max-age=600',
  'Netlify-CDN-Cache-Control':'public, s-maxage=600, durable',
  Vary:'RSC, Next-Router-State-Tree',Location:'/login', 'X-Fixture':'preserve',
});
headers.append('Set-Cookie','first=a; Path=/');
headers.append('Set-Cookie','second=b; Path=/');
const cookies = headers.getSetCookie();
applyPrivateResponseHeaders(headers);
assert.equal(headers.get('Cache-Control'),'private, no-cache, no-store, must-revalidate, max-age=0');
for (const key of ['CDN-Cache-Control','Netlify-CDN-Cache-Control']) assert.equal(headers.get(key),'no-store');
assert.deepEqual(headers.getSetCookie(),cookies);
assert.equal(headers.get('Vary'),'RSC, Next-Router-State-Tree');
assert.equal(headers.get('Location'),'/login');
assert.equal(headers.get('X-Fixture'),'preserve');
assert.equal(headers.get('Expires'),'0'); assert.equal(headers.get('Pragma'),'no-cache');
const once = [...headers]; applyPrivateResponseHeaders(headers); assert.deepEqual([...headers],once);
for (const path of ['/dashboard','/dashboard/','/dashboard/report.csv']) assert.equal(isProtectedPagePath(path),true);
for (const path of ['/','/login','/dashboard-public','/dashboards','/api/health','/_next/static/app.js']) assert.equal(isProtectedPagePath(path),false);
```

- [ ] Run unit file under react-server conditions. Expected: RED from missing policy modules, not a tooling error.
- [ ] Implement both server-only exports and package unit command. Do not export mutable shared Headers or add response/authorization side effects.
- [ ] Run unit command, typecheck and lint. Expected: tests PASS, no type/lint errors. Commit `feat(VOLO-118): define private browser and CDN cache policy`.

### Task 2: Apply policy at existing response ownership boundaries

**Files:** Modify Proxy, server client, JSON mutation adapter, Proxy unit and existing clients/Proxy/protected-app/mutation verification scripts.

**Interfaces:**
- Consumes Task 1 exports. Preserve `refreshSupabaseSession(request):{response,finalizeResponse}`, existing server client discriminated cookieMode/sink options, and `handleRouteMutation` signatures/results.
- Proxy private condition is incoming project session OR updates.size > 0 OR failed verification OR isProtectedPagePath(request.nextUrl.pathname). Apply after SDK metadata and cookie persistence, including replacements. No Auth call solely because a path is protected.
- Writable SDK adapter constructs Headers from provided metadata, applies policy, then passes `Object.fromEntries(headers)` through the existing sink before writing cookies. Read-only behavior stays unchanged.
- JSON adapter builds its response Headers with the common helper; retain status/result/method/error semantics.

- [ ] Update the Proxy unit baseline: anonymous `/dashboard` now expects common private/CDN policy; anonymous `/` and PKCE-only public requests still skip Auth and do not acquire private headers. Add finalizer redirect and JSON replacements initially carrying conflicting public CDN fields; assert common policy, unchanged status/body/location, identical caller cookies/options, and no request-cookie forwarding leak.
- [ ] Extend real SDK `/api/seed` fixture response assertions: empty incoming jar, successful cookie establishment, both CDN fields no-store and correct caller cookies. Extend client sink-failure tests to prove cookies remain unwritten on failure and unrelated metadata survives. Cover SDK deletion and chunk replacement.
- [ ] Extend API/protected fixture assertions for all adapter-created success/denial/error/method responses and HTML/RSC/prefetch/redirect variants. In mutation Action checks, require common CDN policy for session-bearing responses and retain Next's own no-store contract for anonymous responses; do not assert framework-controlled Action HTTP errors equal JSON status mappings.
- [ ] Run modified Proxy unit/client/Proxy/protected/mutation suites before integration. Expected: RED missing CDN directives or old anonymous protected policy; record the exact failing assertions.
- [ ] Integrate common helper with the three response owners. Keep original failure behavior, cookie cleanup restrictions and access/effect semantics. Do not add global headers rules or change the matcher.
- [ ] Run changed suites and Task 1 units, typecheck/lint. Expected: GREEN across real SDK cookie establishment, replacement/outage protection, dynamic page and Action/API transports. Commit `fix(VOLO-118): enforce private cache policy at response owners`.

### Task 3: Prove same-URL cache isolation and characterize browser history

**Files:** Create shared-cache helper/tests, cache fixture helper and integration script; add integration/combined commands to package.json.

**Interfaces:**
- `CacheReply` shape `{status:number,headers:Headers,body:string}`. Test-only `createSharedCache()` returns `{request(key:string,load:()=>Promise<CacheReply>):Promise<{reply:CacheReply,hit:boolean}>, size:()=>number}` with copies on storage/retrieval.
- Model selects Netlify-CDN-Cache-Control > CDN-Cache-Control > Cache-Control. Refuse private/no-store/no-cache, nonpositive/absent TTL, and every status except 200; retain only deliberately explicit public positive-TTL controls. This conservative model claims only these exercised cases, not a complete Netlify cache implementation. TTL uses s-maxage ahead of max-age; never silently serve stale or fall back after a load failure.
- `startCacheFixture()` returns owned `{origin,directory,backend,accounts,request,close,output}`. `accounts` supplies fictional A/B jars and mutable membership entries from startAccessFixture. `request(path,jar,headers?)` returns CacheReply and performs canary checks; callers explicitly absorb Set-Cookie only into the correct jar. `close()` tears down every owned resource.
- Fixture copies real lib/config/Proxy/protected layout/page; adds `/dashboard/cache-check` rendering only a verified fictional subject marker, `/api/cache-check` independently guarded JSON with explicit common policy, and a deterministic public positive-cache control. No fixture route ships.
- `test:cache:http = node scripts/verify-private-cache.mjs`; `test:cache = npm run test:cache:unit && npm run test:cache:http`. Regular discovery includes shared-cache.test.mjs.

- [ ] Write model tests: positive public control loads once then hits; private/no-store at each precedence level loads each time; highest-precedence public overrides lower cache fields in the model; mutation of returned Headers never alters stored copies. Assert an intentionally weakened private fixture copy replays A to B and the subject-isolation assertion throws. Expected: RED missing model before implementation, then GREEN proving both storage and detection controls.
- [ ] Write integration script against the missing fixture helper. Expected: RED missing fixture, then define the production fixture. Use whitelisted fictional env, real Next webpack build, local backend only, independent output/cookie canaries and cleanup on setup/test failure.
- [ ] On `/dashboard/cache-check` and `/api/cache-check`, alternate A/B/anonymous/A on identical URLs through the model and direct origin. For each applicable HTML/RSC/prefetch variant assert `hit === false`, own subject only, no foreign cookie, policy no-store and fresh membership calls on every authorized response. Follow same-origin RSC negotiation hops without dropping variant headers. A prefetch may omit personalized output; it must never include another subject or become cacheable.
- [ ] Warm A, disable A, then repeat the same URL: no A content, fresh membership, forbidden result. Reactivate, warm success, induce Auth and membership outages separately: sanitized unavailable result, zero old private fallback; recover and prove a fresh success. Include expired/rejected sessions, refresh chunk changes and rotation-before-outage using existing fixture capabilities or established Proxy transport cases without fabricating backend behavior.
- [ ] Verify dynamic protected routes absent from prerender manifest; public anonymous home/login remain unprivatized; hashed assets retain immutable/public policy and skip Auth even with a fictional jar. Verify callback redirect/cookie policy via Task 2 SDK/finalizer fixtures and common helper, without introducing product callbacks.
- [ ] Support `--browser` on verification script: after assertions, keep only this owned loopback fixture alive and print its origin. Visible fixture-only controls establish/clear fictional A/B cookies and disable/reactivate A through a local control service; server redirects after session changes create fresh navigation. Keep this mode out of CI and close on termination. Never print cookie/token values.
- [ ] Use browser tools for A → public → back, disablement → back/forward → refresh, A → signed-out → B. Read fixture server call counts around each action and record actual DOM/subject and whether server verification occurred. Expected: fresh requests reject revoked/signed-out access and B never receives A's fresh response; retained historical DOM is explicitly recorded as already-delivered client state. Stop and diagnose any actual shared-response replay. Capture screenshots, terminate browser fixture, and record observations for Task 4 docs.
- [ ] Run `npm test`, `npm run test:cache`, plus affected existing suites. Expected: GREEN, shared-cache positive control hits while protected/session replies never store; no secret/error markers in output/assets. Commit `test(VOLO-118): verify same-URL private cache isolation`.

### Task 4: CI, compiled boundaries and hosted handoff

**Files:** CI, boundary script, smoke tests, `scripts/verify-preview-cache.mjs`, README, environment/preview/auth docs and Jira evidence.

**Interfaces:**
- CI invokes `npm run test:cache` after protected-app/mutations and before compiled boundaries.
- Preview script requires `SMOKE_BASE_URL` HTTPS origin and performs anonymous GET/HEAD requests only. It records whitelisted cache/status/age fields, status and cookie count; never dumps response cookies or query tokens. Export no product API.
- Docs preserve distinction: local cache model evidence, actual local browser evidence, anonymous hosted CDN evidence, and deferred authenticated hosted verification under VOLO-110.

- [ ] Add compiled Client Component import denials for both new server-only modules. RED control removes only the marker in a disposable copied module with no server-only transitive import; require the client build unexpectedly succeeds, then restore actual copy and prove imports fail for server-only reason.
- [ ] Extend anonymous smoke assertions to generic CDN no-store on protected routes when exposed, all RSC negotiation/redirect hops and no unexpected session cookies. Add preview report: repeat identical dashboard HTML/RSC/prefetch and public/static URLs at least three times, record policy and Cache-Status/Age; require private no-store and no reported shared-cache hit for protected responses. Netlify-specific header may be consumed; no-store plus non-storage evidence is required, a miss alone is insufficient. Preserve public control behavior without demanding CDN hits in every environment.
- [ ] Run full required local checks: typecheck, lint, webpack build, regular tests, clients, Proxy unit/HTTP, access unit/HTTP, protected-app, mutations, cache unit/HTTP, boundaries and git diff --check. Expected: all PASS. Use fictional env; serialize root build/type generation, batch only independent disposable fixtures.
- [ ] Document five headers/ownership/path registration, uncached data and dynamic rendering, positive/negative controls, browser observations, auth/session-change invalidation responsibility and no instant history-erasure claim. Record no product endpoint/callback, no global disable and no hosted authenticated write test. Add exact sources from spec. Commit `docs(VOLO-118): enforce cache checks and document auth handoff`.
- [ ] Perform one fresh whole-branch review using preserved native method. Address blocking findings with RED→GREEN proof; record rulings/deferred minors. Push feature branch and create/attach PR against main after local gates pass. Expected: exact-head CI/default bundler/database policies and automatic Netlify Deploy Preview pass; no production publishing.
- [ ] Run full anonymous preview smoke and preview cache report, plus browser home → dashboard → fixed login → home navigation. Record head, CI/deploy URLs and cache observations in VOLO-118 and docs/Jira handoff. Notify VOLO-21/22/23/110 of the common policy and required future authenticated checks without expanding their scope. Keep VOLO-118 In Progress until user merge and ancestry verification. Preserve feature checkout for PR feedback.

## Execution and evidence

Preserve the user's native execution method: implement inline, maintain an owned
task ledger with exact RED/GREEN outcomes, then one fresh whole-branch reviewer.
Use bundled Node and the existing npm launcher if tools are absent from PATH.
Loopback/network permission failures require normal escalation, not product fixes.
Compare every verification command's output with its Expected result; record any
spec/plan conflict as a ruling before proceeding. This plan adds no deployment
until local verification/review is complete and makes no production release.
