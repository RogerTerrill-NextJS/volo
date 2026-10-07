# Supabase SSR Clients Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement typed browser and isolated per-request Supabase server clients with explicit cookie ownership.

**Architecture:** Reuse the public configuration helper and generated Database type. Delegate session storage to the SSR SDK, with a server-only factory that awaits Next.js cookies and requires a read-only/read-write mode. Verify the real modules in a disposable Next.js app and loopback Auth stub.

**Tech Stack:** Next.js 16.3.8, React 19.2.8, Node.js 24, strict TypeScript, Supabase JS/SSR, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-06-volo-113-supabase-clients-design.md` (approved and merged in PR #13).

## Global Constraints

- Next.js 16.3.8 App Router, React 19.2.8, Node.js 24 and TypeScript strict mode.
- Keep the generated database types unchanged unless independently regenerated.
- Never import the server factory into browser code. Never share a server client across requests or replace publishable configuration with service-role keys.
- Keep app CI offline with its existing dummy public values. Any additional SDK fixture uses a loopback stub, never the shared hosted Supabase backend.
- Use a `feature/` branch, reviewed PR and Netlify Deploy Preview. Production auto-publishing stays locked; merging does not release production.
- No page protection, Proxy refresh, login/logout, callback, hosted Auth or database changes in this implementation.

## Review Focus

- Browser factory imported during server rendering: construction succeeds without browser globals or a server session singleton (Task 1/3).
- Cookie deletion and chunk replacement: all SDK options and zero-maxAge removals survive (Task 2).
- Writable mode used in a read-only context or a failing cookie store: errors remain visible, without partial success being reported (Task 2).
- Concurrent requests with different sessions: clients and cookie writes remain isolated (Task 2).
- Replacement responses and SDK cache metadata: required protections cannot disappear silently at the client boundary (Task 2/3).

## Task 1: Typed browser client and dependencies

**Files:** Create `lib/supabase/client.ts`; modify `package.json`, `package-lock.json`; create `tests/supabase-clients.test.mts`.

**Interfaces:** Consumes `getSupabasePublicConfig(): { url: string; publishableKey: string }` and generated `Database`. Produces `createBrowserSupabaseClient(): SupabaseClient<Database>`.

- [ ] Inspect stable package metadata/peer requirements, install compatible stable Supabase JS/SSR versions, and inspect their installed factory and cookie types. Pin chosen direct dependency versions and retain the lockfile. Re-read bundled Next.js cookies guidance before writing code. This is dependency preparation; no app behavior changes yet.
- [ ] Write failing Node tests importing the missing browser factory. Assert sanitized failures for missing/invalid public configuration even if a previous client was constructed; assert a typed client can be constructed with fixtures when `window`/`document` are absent. Preserve/restore test environment state. Do not call a real backend.

```ts
assert.throws(() => createBrowserSupabaseClient(), /NEXT_PUBLIC_SUPABASE/);
assert.ok(createBrowserSupabaseClient().auth);
```

- [ ] Add an explicit npm test pattern for `tests/*.test.mts` alongside existing `.mjs` tests, using Node 24's supported TypeScript execution. Use explicit relative TypeScript imports; retain the existing smoke test behavior.
- [ ] Run `node --test tests/supabase-clients.test.mts`; expect the missing-module failure before implementation.
- [ ] Implement `lib/supabase/client.ts` with validation before SDK invocation and `createBrowserClient<Database>`. Keep SDK browser defaults and no application-managed singleton. Do not mark this utility as a component or introduce privileged configuration.
- [ ] Run the focused tests and TypeScript. Add a compile-time type check that a memberships query uses generated fields and an invalid table fails under `@ts-expect-error`; keep this in the TypeScript test file so `tsc --noEmit` validates it without making requests.
- [ ] Commit the typed browser foundation and dependency/test-runner changes after focused tests pass.

## Task 2: Request-scoped server factory and cookie behavior

**Files:** Create `lib/supabase/server.ts`, `scripts/verify-supabase-clients.mjs`; modify `package.json` and `.github/workflows/ci.yml` using the existing app job.

**Interfaces:** Produces `createServerSupabaseClient(options: { cookieMode: 'read-only' | 'read-write' }): Promise<SupabaseClient<Database>>`. The verification script is a standalone process: exit 0 only if all fixture assertions pass; nonzero on any failure. It owns its loopback stub, temporary app and child Next.js process and cleans them up in `finally`.

- [ ] Write the failing verification fixture before the server factory. Use the existing boundary script's disposable-app pattern, copied real lib modules and sanitized synthetic environment; never checkout `.env` files. Supply a loopback Auth stub with only the SDK endpoints exercised by synthetic setSession/getUser behavior, using valid-format synthetic JWTs with fictional user IDs and deterministic expiry. Deny/record unexpected outbound requests.
- [ ] Fixture routes import the missing real server factory, create read-write clients and establish SDK sessions against that stub. Responses expose only booleans/fictional user IDs needed for assertions; never real credentials. A Server Component constructs a read-only client and reads its synthetic session. Tests may inspect synthetic Set-Cookie internally without printing token values.
- [ ] Assert the following against real Next.js request/response behavior:

```js
assert.equal(readOnlyResponse.status, 200);
assert.equal(firstUserAfterWrite, fictionalUserA);
assert.equal(secondUserAfterWrite, fictionalUserB);
assert.equal(firstUserAfterConcurrentRequests, fictionalUserA);
assert.equal(secondUserAfterConcurrentRequests, fictionalUserB);
assert.ok(chunkCookies.length > 1);
assert.ok(removalCookies.every(cookie => cookie.maxAge === 0));
```

  Use separate cookie jars, concurrent requests and a session large enough to exercise SDK chunking; replace it with a smaller session and verify obsolete chunks are cleared. Assert path, sameSite, expiry/removal and the supplied SDK options. A writable factory used from a Server Component must fail on an attempted write. An invalid mode must fail without returning a client.
- [ ] Run `node scripts/verify-supabase-clients.mjs`; expect failure importing the missing server module. Use loopback-only verification and the host's documented webpack fixture build path.
- [ ] Implement the factory with `import 'server-only'`, required mode validation, `await cookies()`, public configuration, fresh `createServerClient<Database>` and `getAll`. Omit `setAll` in read-only mode where the installed API permits it. Writable `setAll` applies each complete cookie through the current cookie store; no blanket try/catch or global client/cache.
- [ ] Honor the installed cookie callback signature. If it supplies cache metadata, expose a required response-header sink for writable callers and update the spec/interface documentation to state that supported signature; test the sink receives every required header and failures propagate. If the installed signature contains only cookie writes, document that the owning response must apply private/no-store protections under VOLO-114/118; do not invent unsupported SDK arguments.
- [ ] Add a small focused store-failure fixture if Next.js's prohibited-write test does not cover propagation through the actual adapter. Verify the SDK operation itself reports failure rather than claiming persisted success; do not just inspect callback invocation.
- [ ] Run the fixture to success and add `npm run test:clients` for it in app CI after ordinary tests. The stub does not require Docker, hosted keys or Supabase users. Keep readiness and process timeouts bounded and cleanup reliable.
- [ ] Commit the server factory and integration verification after success.

## Task 3: Build boundaries, documentation and PR validation

**Files:** Modify `scripts/verify-supabase-boundaries.mjs`, `docs/environment-configuration.md`, `README.md`; adjust the Task 2 fixture only as needed for shared verification.

**Interfaces:** Existing `npm run test:boundaries` remains valid and retains its privileged canary checks. Both scripts compile the real typed client modules rather than copied implementations.

- [ ] Add a failing Client Component import case for `lib/supabase/server.ts`. Assert the Next.js build fails specifically for the server-only boundary, not an unrelated missing dependency or configuration error.
- [ ] Build a valid fixture importing/calling the real browser factory in a Client Component and the real server factory in a Server Component/Route Handler. Add assertions proving the browser factory ran without contacting a hosted backend and public URL/key are emitted in browser JavaScript. Preserve existing privileged canary asset/HTML/RSC/JSON/header checks.
- [ ] Run `npm run test:boundaries` and `npm run test:clients`; require both to succeed. Verify no production test routes were added and test fixtures do not load real `.env` values. Re-run focused TypeScript tests for generated Database typing.
- [ ] Document factory imports, required modes, fresh server request ownership, writable contexts, sanitized failures, read-only persistence limitations and the pending VOLO-114 Proxy requirement. Document the installed SDK versions and verification command. Warn callers that factories do not authenticate/authorize access or replace VOLO-115 guards.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`, `npm run test:clients`, `npm run test:boundaries`, and `git diff --check`. On this host use the bundled Node binary; local build may use `next build --webpack` for the documented worker issue, while hosted CI must pass the default bundler. Escalate only when sandboxed network/loopback execution needs it.
- [ ] Use the requesting-code-review skill for a fresh branch review; fix material findings. Commit intended files and push the feature branch. Open/attach a VOLO-113 implementation PR and wait for existing CI and Netlify preview checks.
- [ ] Run `SMOKE_BASE_URL=https://deploy-preview-<PR-number>--voloapp.netlify.app npm test`. Record the tested commit, preview URL and results in Jira. Keep real auth refresh/RLS claims out of this evidence and leave production publishing locked.

## Completion and continuation

VOLO-113 is complete only when the implementation and meaningful verification
have merged, not when this plan merges. After that, continue with VOLO-114's
Proxy/session-refresh design using the installed factory behavior; do not treat
approval of this plan as approval of an unwritten VOLO-114 design.

Recommended execution: Native. These three tasks share client interfaces and
the disposable Next.js test harness; one implementer can keep them coherent,
followed by a fresh whole-branch review.
