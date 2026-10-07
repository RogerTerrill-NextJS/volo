# Protected Mutation Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide independently verified, origin-safe mutation boundaries and prove denied requests cause zero effects.

**Architecture:** Capture one trusted origin at build time. Shared server-only authorization/input orchestration serves JSON Route Handlers and FormData Server Actions, with production-built disposable Next fixtures proving both transports. Ship reusable helpers and documentation without a product mutation endpoint.

**Tech Stack:** Next.js 16.3.8 App Router, strict TypeScript, existing Supabase clients, Node 24 native tests; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-07-volo-117-mutation-boundaries-design.md` (approved).

## Global Constraints

- Use feature/ branches; existing branch is `feature/volo-117-mutation-boundaries`, base main `0d629ea`. Preserve the established sandbox fallback to this checkout.
- Deploy Previews and production only; no production release, hosted authenticated tests, writes, new credentials or artificial product endpoints.
- Read relevant installed Next guides before code: data-security, serverActions configuration, Route Handlers and headers; inspect installed action-handler/React decoder for transport details.
- Keep existing access verification, Proxy refresh, explicit cookie ownership and user RLS; no privileged client, migration, new dependency or shared authorization cache.
- Exact build-pinned origin; no request Host/forwarded-host trust, wildcard origins, referer fallback or sibling-preview trust.
- JSON default 16 KiB, positive overrides at most 64 KiB, actual streamed bytes and five-second read deadline. Action fields at most 16 KiB; Next raw Action limit 64 KiB.
- Require explicit roles, operation parser and permission callback before one effect. Downstream consumers own transactions/idempotency and minimal DTOs.

## Review Focus

- A runtime environment change must not replace a build's origin: compiled fixture restart with a conflicting value still rejects it (Task 1/2).
- An external Origin paired with forged matching forwarded Host must fail even when Next's built-in comparison accepts it (Task 3).
- Native multipart action metadata must not bypass app-field validation or become effect input (Task 3).
- Absent/misleading Content-Length and slowly streamed bodies must remain bounded without effects (Task 2).
- A callback failure after a partial effect must not retry or claim rollback (Task 2).

## Files and responsibilities

| File | Responsibility |
| --- | --- |
| `lib/auth/mutation-origin.mjs` | Pure build-context resolver and strict origin syntax validation |
| `lib/auth/mutation-request.ts` | Server-only request-origin policy and expected input errors |
| `lib/auth/mutation.ts` | Typed result/policy and fresh authorization orchestration |
| `lib/auth/mutation-input.ts` | Bounded JSON reader and text-only FormData normalization |
| `lib/auth/route-mutation.ts` | JSON HTTP adapter, methods, status/cache mapping |
| `lib/auth/action-mutation.ts` | Request-header Action adapter and sanitized result |
| `tests/mutation-origin.test.mjs` | Pure build-origin configuration cases |
| `tests/mutation-policy.unit.mts` | Request/body/form policy tests under react-server conditions |
| `tests/helpers/mutation-fixture.mjs` | Temporary Next app, fictional backend/effect recorder, transport helpers |
| `scripts/verify-mutations.mjs` | Real Action/API security assertions and cleanup |
| `next.config.ts`, `package.json`, `.github/workflows/ci.yml` | Pin non-secret origin, Action raw limit, commands and CI |
| `scripts/verify-supabase-boundaries.mjs` | Compiled client-import denials for mutation modules |
| `.env.example`, `README.md`, `docs/environment-configuration.md`, `docs/auth-callbacks.md`, `docs/preview-verification.md` | Origin setup and downstream mutation handoff |

### Task 1: Pin trusted origins and implement request/input policy

**Files:** Create `mutation-origin.mjs`, `mutation-request.ts`, `mutation-input.ts` and the two unit test files above. Modify `next.config.ts`, `.env.example`, `package.json`.

**Interfaces:**
- Produces `resolveMutationOrigin(env: Record<string,string|undefined>): string`: Netlify deploy-preview -> DEPLOY_PRIME_URL, production -> URL, otherwise local explicit VOLO_MUTATION_ORIGIN or empty string. NETLIFY=true requires a supported CONTEXT and valid HTTPS origin. Nonempty hosted CONTEXT is also hosted evidence; never fall back to local override when hosted metadata is incomplete. Local configured origins allow HTTPS or HTTP loopback only. Sanitized invalid-config error.
- Produces `checkMutationOrigin(headers: Headers, trustedOrigin: string): 'forbidden'|'unavailable'|null`; empty/invalid trusted configuration -> unavailable. Only a single canonical Origin matching scheme/host/port passes. Missing/null/path/query/credentials/multiple origins fail. Sec-Fetch-Site accepts only absent, same-origin or none; everything else fails.
- Produces `MutationInputError` with code `'invalid_input'|'too_large'|'unsupported_media_type'` and generic message.
- Produces `readMutationJson(request: Request, maxBytes?: number): Promise<unknown>`: JSON/optional UTF-8 charset, default 16384, maximum 65536, five-second deadline, actual byte counting/cancellation, strict UTF-8 decode and JSON parse. Invalid limit is an internal configuration exception, not an input error.
- Produces `readMutationForm(form: FormData): Record<string,string>`: only text, no duplicate application keys, UTF-8 name+value sum <=16384. Reserve `$ACTION_` keys for framework metadata: exclude them from business input and count their bytes toward the limit. Operation schemas must reject unknown application keys.
- `next.config.ts` consumes resolver, sets `env.VOLO_MUTATION_ORIGIN` to its resolved value and `experimental.serverActions.bodySizeLimit` to `'64kb'`. No allowedOrigins expansion. Fixtures copy/use the real config/resolver, not a different policy.
- Produces `test:mutations:unit = node --conditions=react-server --test tests/mutation-policy.unit.mts`; pure origin tests join regular test discovery.

- [ ] Write `build origin follows context and rejects unsafe configuration` with preview/production/local/missing/unsupported context cases and sanitized error-canary assertions. Assert preview ignores conflicting local/production values and only accepts its exact origin.
- [ ] Write `origin evidence cannot be replaced by host headers` and `bounded input rejects invalid media, bytes, streams and forms`. Pin expectations:

```ts
assert.equal(checkMutationOrigin(new Headers({Origin:'https://evil.invalid',Host:'evil.invalid','X-Forwarded-Host':'evil.invalid'}),'https://voloapp.netlify.app'),'forbidden');
assert.equal(checkMutationOrigin(new Headers(),'https://voloapp.netlify.app'),'forbidden');
assert.equal(checkMutationOrigin(new Headers({Origin:'http://127.0.0.1:3000'}),'http://127.0.0.1:3000'),null);
assert.equal(checkMutationOrigin(new Headers({Origin:'http://127.0.0.1:3001'}),'http://127.0.0.1:3000'),'forbidden');
await assert.rejects(readMutationJson(oversizedChunkedRequest),{code:'too_large'});
assert.throws(()=>readMutationForm(fileForm),{code:'invalid_input'});
```

- [ ] Run pure/unit tests to RED before implementation. Expected failure is missing new modules, not unavailable tooling. Use a controllable stream for deadline/cancellation tests; observe cancellation and bounded resolution, avoiding leaked timers/readers.
- [ ] Implement the exact interfaces, config wiring and `.env.example` local-origin guidance. Do not require an origin for existing local read-only builds; mutation calls fail closed when absent.
- [ ] Run pure/unit tests GREEN. Cover 16384/16385 byte boundary, multibyte UTF-8, invalid UTF-8/JSON, empty data, invalid limits, declared huge length, no length, stream errors and stalled reads; duplicates/Files/unknown-schema inputs and reserved metadata accounting. Run typecheck/lint and a production webpack build with fictional config.
- [ ] Commit `feat(VOLO-117): pin mutation origins and bound request input` and record task evidence.

### Task 2: Fresh authorization and JSON Route Handler boundary

**Files:** Create `mutation.ts`, `route-mutation.ts`, fixture helper and `scripts/verify-mutations.mjs`; modify package commands.

**Interfaces:**
- Consumes Task 1's origin/input functions and existing `getAccess(): Promise<AccessResult>`, `ActiveMember`, `MemberRole`.
- Produces `MutationCode = 'unauthenticated'|'forbidden'|'unavailable'|'invalid_input'|'too_large'|'unsupported_media_type'|'unsupported_method'|'internal_error'` and `MutationResult<T> = {ok:true;data:T}|{ok:false;code:MutationCode;message:string}`.
- Produces `MutationPolicy<I,O>`: required `allowedRoles: readonly MemberRole[]`, `parse(value:unknown): {ok:true;value:I}|{ok:false}`, `authorize(member:ActiveMember,input:I): boolean|Promise<boolean>`, `effect(member:ActiveMember,input:I): O|Promise<O>`. Treat only literal true as permission, and validate required callbacks/role policy before effects.
- Produces `runMutation<I,O>(headers:Headers, readInput:()=>unknown|Promise<unknown>, policy:MutationPolicy<I,O>): Promise<MutationResult<O>>`. It reads the pinned `process.env.VOLO_MUTATION_ORIGIN` internally, follows spec sequencing, catches expected input failures separately, and sanitizes unexpected exceptions. Never takes trusted member/origin as caller-controlled action input.
- Produces `handleRouteMutation<I,O>(request:Request, options:{method:'POST'|'PUT'|'PATCH'|'DELETE';maxBytes?:number;policy:MutationPolicy<I,O>}): Promise<Response>` with exact status mapping 401/403/503/400/413/415/405/500 and success 200. Unsupported method returns Allow for the selected method. Always private/no-store, no CORS grants or automatic retries.
- Produces `test:mutations:http = node scripts/verify-mutations.mjs`, and fixture helper lifecycle/transport utilities used by Task 3. Tests permit phase-selective API execution before Action fixtures exist.

- [ ] Write initial real Next fixture assertions `direct authorized API calls produce one verified effect` and `denied API calls produce no effects`, then run `test:mutations:http` to RED because the adapter is missing.
- [ ] Build the fixture with copied real lib/config and minimal root layout, fictional SDK cookies via `startAccessFixture`, outbound fetch allowlist and independent loopback effect recorder. Keep fixture-only effect endpoint in the local recorder, never hosted app code. Recorder captures verified subject, validated input and invocation count; reject unexpected backend requests. Reserve the app port before build so its origin can be pinned.
- [ ] Implement orchestration and HTTP adapter. Explicit membership/role/resource gates precede effect construction. Private errors contain no submitted values or upstream exception details. Preserve existing getAccess/Proxy/cookie contracts.
- [ ] Run fixture GREEN for successful member/admin cases and denial matrix: anonymous, malformed/forged/revoked cookies, disabled/absent membership, forbidden role/resource, metadata/input role spoofing, Auth/membership unavailable, missing/invalid origins, hostile/sibling origin, scheme/port differences and spoofed forwarding headers. All denials assert unchanged effect count and no data leakage. Every new request rechecks membership; disable then reactivate the same JWT and verify behavior changes.
- [ ] Add actual HTTP coverage for GET/HEAD/OPTIONS and other unsupported methods, 415 media, JSON/schema failures, stream size/read deadline, runtime-origin override, parser/authorize exceptions and concurrent users. Pin assertions:

```js
assert.equal(denied.status,403);
assert.equal(effects.length,before);
assert.match(denied.headers.get('cache-control'),/private.*no-store/);
assert.equal(valid.status,200);
assert.equal(effects.length,before+1);
assert.equal(effects.at(-1).userId,verifiedSubject);
assert.equal(partialFailure.status,500);
assert.equal(partialEffectCalls,1); // No automatic retry or rollback claim.
```

- [ ] Use raw Node HTTP where fetch cannot send misleading Content-Length; distinguish framework/HTTP-parser rejection from adapter rejection, but require zero effects for both. Keep pure stream tests as direct evidence for the adapter's byte count/deadline if HTTP framing rejects the request first.
- [ ] Test build pinning by restarting the same compiled fixture with a conflicting runtime VOLO_MUTATION_ORIGIN: original origin remains allowed, new origin denied. Scan HTML/RSC/JSON/headers/browser assets/output for synthetic secret/raw-error canaries. Teardown owned app/recorder/backend resources even on failures.
- [ ] Run all mutation unit/API tests, typecheck/lint, commit `feat(VOLO-117): guard JSON mutations with fresh authorization` and record evidence.

### Task 3: Server Action guard and both Action transports

**Files:** Create `action-mutation.ts`; extend fixture helper and mutation verification script. No product app Actions/forms.

**Interfaces:**
- Consumes `runMutation`, `MutationPolicy`, `MutationResult`, `readMutationForm` from earlier tasks.
- Produces `handleActionMutation<I,O>(form:FormData,policy:MutationPolicy<I,O>): Promise<MutationResult<O>>`: uses actual `await headers()` from next/headers, normalizes the form through the input callback, delegates fresh authorization to runMutation.
- Fixture-only explicit 'use server' actions call this wrapper and return minimal results. Native useActionState fixture can render semantic codes after submission; bound initial state is not an authorization argument. Decode only Next-owned action-selection metadata; application arguments never supply identity/request evidence.

- [ ] Write `direct fetched action and native form enforce the same guard`, run fixture to RED with missing Action adapter. Discover actual action IDs from compiled manifest or rendered form; never hardcode an ID from another build or require dashboard navigation.
- [ ] Implement the small Action adapter. Keep wrapper server-only without 'use server'; only consumer entry points use it. Effect callbacks return DTOs; any redirect/revalidation occurs explicitly afterward.
- [ ] Verify successful member/admin effects and repeat the identity/membership/role/resource/origin denial matrix for fetch/RSC and native multipart submissions. Check semantic result and independent effect count; Next may use 200/500 for Action wire responses or redisplay the form. No protected result/credential leakage on failures.
- [ ] Demonstrate the framework's built-in external-Origin rejection independently with a fixture-only bare counter action; missing Origin may reach that bare action but must never reach a guarded effect. Pair hostile Origin with matching X-Forwarded-Host so Next's comparison passes, then assert the custom pinned-origin guard denies. Do not weaken framework protections globally.
- [ ] Cover native action-selection fields, extra application fields, duplicates, Files, invalid types/schema, 16384/16385 UTF-8 bytes and raw multipart over 64 KiB. Wrong-method requests cause zero effects, without assuming Next returns 405 for a GET of the containing page.
- [ ] Cover malformed Action payloads, unavailable services, parser/authorize/effect exceptions and post-effect exception no-retry behavior. Scan result/output/assets for canaries; forwarded Next diagnostics can contain synthetic untrusted origins, but never credential or backend error markers.
- [ ] Run mutation units/API/Action fixture GREEN, typecheck/lint and commit `feat(VOLO-117): guard Server Actions and verify direct invocation`.

### Task 4: CI, compiled boundaries and downstream handoff

**Files:** Modify CI/package commands, compiled boundaries, README/environment/auth/preview docs. Update Jira evidence during PR handoff.

**Interfaces:**
- Produces `test:mutations = npm run test:mutations:unit && npm run test:mutations:http`; CI invokes it after test:protected-app.
- Boundary checks consume all five server-only modules: mutation-request, mutation-input, mutation, route-mutation, action-mutation. The pure build resolver intentionally remains configuration-safe.
- Documentation consumers VOLO-21/22/23 distinguish protected member writes from pre-membership auth flows, which need separate origin/admission policy.

- [ ] Add a compiled Client Component import assertion for each module. Confirm the assertion goes RED with a deliberately client-safe stand-in in the disposable fixture (no server-only transitive imports); then restore the actual copied module and prove GREEN. Never remove real product protection to create a test failure.
- [ ] Wire combined command/CI and document exact origin inputs, local setup, build pinning, alias rejection, safe errors, limits, required operation callbacks, RLS/transaction/idempotency ownership and Action result/navigation restrictions. Include small consumer examples consistent with exact signatures.
- [ ] Document the current inventory: no product mutations exist and no Action/API fixture routes ship. Retain public health/unknown-route checks and existing /login?reason=authentication-required redirect contract.
- [ ] Run `npm run typecheck`, `npm run lint`, production webpack build, `npm test`, `npm run test:clients`, `npm run test:proxy`, `npm run test:access`, `npm run test:protected-app`, `npm run test:mutations`, `npm run test:boundaries`, and `git diff --check`. Use fictional env for regular build/tests; read every result. Required hosted CI verifies default bundler and database RLS separately.
- [ ] Commit `test(VOLO-117): enforce mutation boundaries in CI and document consumers`. Perform one whole-branch fresh-context review according to the selected execution method; resolve blocking findings with RED→GREEN evidence, record rulings/deferred minors.
- [ ] Push feature branch once local verification/review passes, create and attach PR against main. Wait for exact-head CI and Deploy Preview; run anonymous read-only preview smoke and browser home/dashboard/login navigation. Do not add a hosted mutation solely for verification or trigger production publishing.
- [ ] Record tested head, CI run, deploy URL, fixture coverage, review findings and hosted-coverage limitation in VOLO-117. Add relevant handoff notes to VOLO-21/22/23 without changing their scope. Keep VOLO-117 In Progress until merge verification; retain feature checkout for review.

## Execution notes

Use the bundled Node runtime and existing npm/pnpm launcher when shell tools are
not on PATH. Loopback binding and network commands may need sandbox escalation;
rerun permission failures with proper escalation rather than treating them as
product regressions. Keep owned temporary fixtures isolated from real .env files.

Native execution remains the user's established method: implement inline, keep a
task ledger with RED/GREEN evidence and deviations, then one fresh whole-branch
review. This plan has four dependent tasks; no per-task agent dispatch is needed.
