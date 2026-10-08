# VOLO-119 Auth integration and handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the existing session/access foundation against disposable real Supabase services and document the remaining auth handoff.

**Architecture:** A Node controller owns a unique temporary Supabase stack, accounts and cleanup. One temporary compiled Next application imports the existing authorization code and exposes test-only HTTP transports. A dedicated CI job runs the real-service matrix; ordinary tests retain offline coverage.

**Tech Stack:** Node 24, Next 16.3.8, React 19.2.8, Supabase CLI 2.119.0, `@supabase/ssr` 0.12.7, `@supabase/supabase-js` 2.117.2, built-in Node test/assert modules. No new dependency.

**Spec:** [Approved design](../specs/2026-10-07-volo-119-auth-integration-design.md).

## Global Constraints

- Use `feature/` branches. Netlify has Deploy Previews and production only.
- Previews share production Supabase. No hosted account creation, authenticated writes, email, callback activation or production publication.
- VOLO-120 remains a deferred Netlify Age/non-storage investigation, not passed evidence.
- Real Auth and PostgREST are mandatory for this suite; missing Docker must fail explicitly. Never substitute simulated services or change `npm test` to require Docker.
- Keep existing app/database jobs, dependencies, product interfaces and schema unchanged. Any product authorization defect requires a scoped decision before changing behavior.
- Read installed Next documentation for authentication, testing, Server Actions, Proxy and cookies before writing fixture code, as AGENTS.md requires.
- Execute inline using the user's preserved native choice, with one fresh whole-branch review at the end. Plan approval precedes implementation.
- On this Mac, record real-service results as pending until exact-head CI passes. Merge and verified ancestry precede Jira Done.

## Review Focus

1. Hosted settings, deceptive URLs or redirects must never send privileged requests outside the owned loopback API (Task 1 safety tests).
2. Partial startup, failed provisioning and interruption must clean only owned resources, including membership-before-user ordering (Task 1 lifecycle tests).
3. CLI/SDK errors or chunked cookies must not leak credentials into diagnostics, summaries or fixture assets (Tasks 1–3 canary tests).
4. Refresh races, deleted cookie chunks and naturally expired tokens must preserve the next request's identity without cross-user mixing (Tasks 2–3 cookie/expiry tests).
5. Unexpired JWTs retained after logout must produce explicit measured evidence; revoked refresh must fail, and a contract contradiction must stop completion (Task 3 termination tests).

---

## File and interface map

All new helpers are test infrastructure. No test route enters `app/` in the repository.

- `tests/helpers/local-auth-stack.mjs`: temporary project/config, CLI lifecycle, destination validation, sanitized diagnostics and account/membership controller.
- `tests/local-auth-stack.test.mjs`: Docker-free safety/lifecycle tests, included by existing `npm test` glob.
- `tests/helpers/real-auth-session.mjs`: real SSR sign-in and independent cookie jars, refresh and logout probes.
- `tests/helpers/real-auth-app.mjs`: compiled temporary Next application, recorder and HTTP/Action transport adapters.
- `tests/real-auth-session.test.mjs`: Docker-free cookie handling tests; never fake a valid integration session.
- `scripts/verify-auth-integration.mjs`: opt-in real-service runner, assertions and sanitized summary.
- `package.json`, `.github/workflows/ci.yml`: opt-in command and separate job.
- `docs/session-integration.md`, `README.md`, `docs/supabase-setup.md`, `docs/environment-configuration.md`, `docs/private-caching.md`: current interfaces, evidence and handoff.

Commands below use `node`/`npm` with Node 24 on PATH. Locally prepend the bundled runtime directory `/Users/rogerterrill/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin` to PATH. `REAL` commands require Docker and run on the dedicated CI runner here; `OFFLINE` commands run on this Mac.

### Task 1: Own and safely dispose of a real local Auth stack

**Files:** Create `tests/helpers/local-auth-stack.mjs`, `tests/local-auth-stack.test.mjs`.

**Interfaces:**
- Produces `validateLocalApiUrl(value: string, expectedPort: number): URL`; require HTTP, literal `127.0.0.1` or `[::1]`, exact owned port, root path, no userinfo/query/fragment. All controller fetches reject redirects.
- Produces `sanitizeDiagnostics(text: string, secrets: string[]): string`; replace known credentials and common credential-bearing fields, without emitting input.
- Produces `startLocalAuthStack({ repositoryRoot: string, jwtExpirySeconds?: number }): Promise<LocalAuthStack>`.
- `LocalAuthStack` has `projectId: string`, `workdir: string`, `apiUrl: string`, `publicKey: string`, `createAccount({label, role, status}): Promise<Account>`, `setMembership(userId, {role, status}): Promise<void>`, `readMembership(userId: string): Promise<object | null>`, `assertNoCredentialLeaks(text: string): void`, `close(): Promise<void>`; `role` is `member | admin | null`, status `active | disabled`. `Account` has `id`, `email`, `password` strings. Admin key remains private to controller closures.
- Lifecycle internals accept injected process/fetch/temp-directory adapters in offline tests; the production entry point always selects actual CLI and HTTP.

- [ ] **Step 1: Write safety tests.** Name cases `rejects_non_owned_destinations`, `does_not_inherit_hosted_settings`, `cleanup_after_partial_start`, `membership_deleted_before_user`, `cleanup_is_idempotent`, `redacts_failed_cli_output`. Assert malformed URLs, HTTP userinfo, external IPs, `127.0.0.1.evil`, wrong ports and 302 destinations fail before fetch; captured argv never contain `--all`, remote/link/reset commands or root workdir. Throw at each setup stage and assert cleanup is scoped to the generated ID, including unsuccessful startup. Assert raw key/password/token canaries never appear in emitted diagnostics.
- [ ] **Step 2: Run RED (OFFLINE).** `node --test tests/local-auth-stack.test.mjs`; expect missing helper/export assertions, not Docker-dependent failures.
- [ ] **Step 3: Implement lifecycle and validation.** Use `mkdtemp`, UUID project IDs and randomly allocated free ports for every enabled host-facing service. Copy checked-in config and migrations only; disable seed loading in the temporary config, leave signup disabled and set `auth.jwt_expiry = 120`. Exact section/key substitutions must each match once or fail. Check Docker availability before CLI startup. Whitelist child environment; do not load root `.env` or forward Supabase/SMTP/provider secrets.
- [ ] **Step 4: Implement owned CLI/account operations.** Invoke the installed CLI through its package entry with `start --workdir <owned-directory>`, then `status --workdir <owned-directory> -o json`, capturing output in memory. Validate the discovered API port against allocation before using keys. Do not consume `DB_URL` or accept database URLs as input: migrations run through the CLI's owned local project/config and its allocated DB port. Require returned public/admin credentials and fail safely if the pinned status shape differs. Provision confirmed `example.invalid` accounts with random passwords via Admin API and memberships via PostgREST; populate disabled fields correctly. Cleanup tracked membership rows before Auth users, then `stop --workdir <owned-directory> --project-id <owned-id> --no-backup`, then owned temp files. Register bounded SIGINT/SIGTERM cleanup and retain an ownership-only state file for CI fallback stop; never persist keys/passwords.
- [ ] **Step 5: Run GREEN (OFFLINE).** `node --test tests/local-auth-stack.test.mjs`; expect all safety tests pass, including failure injection and secret canaries. Real startup remains pending until Task 4 CI.
- [ ] **Step 6: Commit.** `git add tests/helpers/local-auth-stack.mjs tests/local-auth-stack.test.mjs` then `git commit -m "test: add isolated local Auth stack controller"`.

### Task 2: Connect independent real sessions to a compiled Next fixture

**Files:** Create `tests/helpers/real-auth-session.mjs`, `tests/helpers/real-auth-app.mjs`, `tests/real-auth-session.test.mjs`, initial `scripts/verify-auth-integration.mjs`.

**Interfaces:**
- Consumes Task 1 `LocalAuthStack` and `Account`.
- Produces `signInSession(stack: Pick<LocalAuthStack, 'apiUrl' | 'publicKey'>, account: Account): Promise<RealSession>` using real `@supabase/ssr` password sign-in.
- `RealSession` has `userId: string`, `expiresAt: number` (Unix seconds), `cookieHeader(): string`, `applyResponse(response: Response): void`, `clone(): RealSession`, `refresh(): Promise<void>`, `signOut(): Promise<void>`, `probeRetainedCredentials(): Promise<{claims: string, user: string, refresh: string}>`. Private tokens stay in closure; probes return sanitized outcome categories only.
- Session helper also produces `invalidSession(session: RealSession, mode: 'malformed' | 'signature' | 'refresh'): RealSession` for negative requests only, and each session exposes `assertNoCredentialLeaks(text: string): void` to check private token canaries without returning them. Assertions emit a generic failure without echoing the inspected text.
- Produces `startRealAuthApp({repositoryRoot: string, stack: Pick<LocalAuthStack, 'apiUrl' | 'publicKey'>}): Promise<RealAuthApp>`.
- `RealAuthApp` has `origin: string`, `request(path, {session?, method?, headers?, body?}): Promise<Response>`, `mutate(transport: 'json' | 'native' | 'fetched', {session?, origin?: string | null, admin?: boolean}): Promise<Response>`, `effects(): Array<{userId: string}>`, `diagnostics(): string`, `close(): Promise<void>`. `origin: null` omits the Origin header; literal `"null"` sends that value.
- Runner supports `--scenario admission` initially and full default later; exports no privileged product client. Summary artifact path is `.superpowers/sdd/2026-10-07-volo-119-auth-integration/summary.json` (ignored local evidence).

- [ ] **Step 1: Write cookie tests and initial integration assertions.** Offline cases `cookie_jars_do_not_share_state`, `applies_multiple_cookie_headers_and_chunk_deletions`, `clone_preserves_retained_credentials` assert replacement/deletion/order and copy isolation with fictional cookie strings only. Runner `admission` requires A/B/admin subject equality, disabled/absent denial, fixed anonymous login redirect, anonymous mutation rejection and zero rejected effects.
- [ ] **Step 2: Run RED.** OFFLINE `node --test tests/real-auth-session.test.mjs` fails for missing helpers. REAL `node scripts/verify-auth-integration.mjs --scenario admission` is recorded pending on this Mac; on Docker CI it must fail until fixture/controller integration exists. Do not report mocked assertions as real-service RED/GREEN.
- [ ] **Step 3: Implement real session helper.** Disable background auto-refresh; let explicit calls or real Proxy requests own refresh. Use SSR cookie adapters and response `getSetCookie()` rather than splitting comma-separated headers. Keep retained sessions available for destructive probes; no forged positive JWT. Capture canaries privately for runner leak checks and sanitize SDK failures.
- [ ] **Step 4: Implement compiled fixture.** Read installed Next guides first. Follow existing `mutation-fixture.mjs` and `cache-fixture.mjs` production-build, RSC canonicalization and native/fetched Action conventions. Copy merged lib/Proxy, config and protected shell into one temp directory. Add minimal `/app` subject HTML, `/api/subject` guarded JSON, `/api/write` guarded JSON and test Actions/forms. Use actual `getPageAccess`, `getAccess`, explicit role/mutation guards and private-response policy. Record effects through a separate owned loopback server. Child environment contains public config only; outbound allowlist permits the owned API and recorder, rejects redirects to other origins. Fixture close stops child/recorder and removes owned directory, including build failures.
- [ ] **Step 5: Run GREEN.** OFFLINE cookie and controller tests pass. REAL admission command must pass on Docker CI, with all roles, anonymous redirects and effects checked; archive only sanitized scenario outcomes. Fixture startup must use the stack's validated API and cannot fall back to existing simulated helpers.
- [ ] **Step 6: Commit.** Stage the four Task 2 files and `git commit -m "test: connect real Auth sessions to Next integration fixture"`.

### Task 3: Prove authorization, expiry, revocation and isolation end to end

**Files:** Extend `scripts/verify-auth-integration.mjs` and the two real-Auth helpers only as needed for the defined transport interfaces. Extend offline tests for any added cookie/diagnostic utility behavior.

**Interfaces:** Consumes Tasks 1–2 unchanged. Runner default executes every scenario and writes `{commit, versions, scenarios: [{name, status, evidence}], limitations}` with no user IDs, cookies, keys or credentials. On failure, emit sanitized context and nonzero exit; always close fixture and stack. `--cleanup` reads only the owned lifecycle state, validates project ID/path ownership, and stops that stack idempotently without credentials.

- [ ] **Step 1: Add admission/current-row/RLS assertions.** Named scenarios `current_membership`, `role_downgrade`, `real_rls` assert disable A and downgrade admin take effect with unchanged credentials, reactivation restores A, explicit admin policy has a positive control, public user clients see own row and no cross-user row. Both member/admin sessions must fail insert, promote, reactivate and delete; compare controller-observed rows before/after rather than treating an empty mutation response as proof. Controller insert/update success proves setup authority.
- [ ] **Step 2: Add credential and expiry assertions.** `malformed_session` and `corrupted_signature` deny effects. `explicit_refresh` rotates real credentials and keeps jars isolated. `natural_expiry` signs in dedicated sessions after fixture build, records `expiresAt`, waits until expiry + 2 seconds with a maximum 180-second wait and 240-second scenario deadline, then requests through Proxy, applies returned cookies and succeeds on the next request. A separate real expired session with an invalid refresh token must deny. Never alter a valid JWT expiry; fail with a sanitized configuration finding if the actual lifetime exceeds the bound.
- [ ] **Step 3: Add termination assertions.** `retained_credentials_after_logout` retains a separate session, signs it out, probes original credentials with actual `getClaims`, `getUser`, refresh and application access independently. Assert revoked refresh fails; record the pinned stack's unexpired access-token observations. Do not automatically convert unexpected application acceptance/status mapping into a passing baseline: compare with the documented security contract and stop/report contradictions before product changes.
- [ ] **Step 4: Add transport/isolation/cache/leak assertions.** `parallel_identity_isolation` alternates and concurrently requests identical HTML/RSC/JSON URLs for A/B/anonymous and checks bodies, subjects, cookies and effects. `origin_matrix` tests missing/foreign/literal-null Origin across JSON/native/fetched Actions plus same-origin successes. `private_cache` checks effective browser no-store plus CDN and Netlify CDN no-store on reads, redirects, failures and mutations; permit Next's Action browser header format and empty private prefetch, with public/static cacheable controls. `credential_leaks` scans response bodies, non-cookie headers, static assets and captured child logs against all known key/token/password canaries; inspect Set-Cookie only in memory and exclude intentional cookie transport from leak failures.
- [ ] **Step 5: Run RED/GREEN (REAL).** `node scripts/verify-auth-integration.mjs`; each added assertion must initially expose a missing scenario/behavior before implementation. Then expect every named scenario and positive control pass, zero rejected effects and a sanitized summary. Reuse one compiled fixture; isolate destructive credential cases. On this Mac run `node --test tests/local-auth-stack.test.mjs tests/real-auth-session.test.mjs` and leave REAL execution explicitly pending.
- [ ] **Step 6: Commit.** Stage Task 3 runner/helper/test changes and `git commit -m "test: cover real Auth expiry authorization and isolation"`.

### Task 4: Run dedicated CI and publish the evidence-backed handoff

**Files:** Modify `package.json`, `.github/workflows/ci.yml`, `README.md`, `docs/supabase-setup.md`, `docs/environment-configuration.md`, `docs/private-caching.md`; create `docs/session-integration.md`.

**Interfaces:** Add `npm run test:auth:integration` = `node scripts/verify-auth-integration.mjs`. New CI job ID `auth-integration`, Ubuntu, Node 24, `npm ci`, no repository secrets, 30-minute job timeout and a 20-minute integration-step timeout. Always run `node scripts/verify-auth-integration.mjs --cleanup` and upload only sanitized `summary.json` using the repository's upload-artifact action version. Keep existing jobs intact.

- [ ] **Step 1: Verify the pre-change gap.** Confirm package command and CI job are absent. Review the approved spec matrix against the runner's named scenarios; missing coverage blocks completion. No snapshot test for documentation or YAML plumbing.
- [ ] **Step 2: Wire dedicated CI.** Add the opt-in command/job above. Capture CLI output privately, never print status JSON. Cleanup fallback runs even after timeout; forced runner destruction remains an explicit external limit. Upload summary on failure/success, with no raw logs or credentials. Keep the existing validate/database job commands unchanged.
- [ ] **Step 3: Write handoff guide and links.** Document prerequisites/command, owned-stack lifecycle, 120-second expiry and time bounds, interfaces/failure mappings and current membership behavior. Separate real-service, simulated outages/deadlines, browser history/Router Cache and hosted CDN evidence. Link remaining work to VOLO-21, VOLO-22, VOLO-23, VOLO-107, VOLO-110 and deferred VOLO-120. Update stale current-foundation descriptions; preserve dates/context of historical hosted observations. State refresh reauthorizes, history can restore delivered content, and local headers do not establish Netlify storage behavior.
- [ ] **Step 4: Run applicable local checks.** With synthetic public Supabase config, run `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`, `npm run test:clients`, `npm run test:proxy`, `npm run test:access`, `npm run test:protected-app`, `npm run test:mutations`, `npm run test:cache`, `npm run test:boundaries`, then `git diff --check`. Expect all pass. Investigate any failure before claiming success; do not silently fix unrelated product behavior or change a baseline.
- [ ] **Step 5: Commit and obtain exact-head service evidence.** Stage Task 4 files and `git commit -m "ci: verify real Auth integration and document handoff"`. Push feature branch, open PR and attach its URL through the app artifact tool. Require exact-head validate, database and auth-integration jobs pass; inspect sanitized summary. A Docker/startup/test failure requires a fix and fresh exact-head checks, not a skipped success. Record real-service outcomes in the guide; any subsequent commit needs matching checks.
- [ ] **Step 6: Review and preview.** Use the verification and requesting-code-review skills; obtain one fresh whole-branch review under the preserved native workflow, resolve findings, then recheck affected commands. Verify PR Deploy Preview commit/runtime and anonymous public/protected navigation only. Record VOLO-120 as deferred, maintain production lock, and present review-ready PR/results. After user reports merge, fetch and verify PR commit ancestry on main before marking VOLO-119 Done.

## Plan self-review

Spec lifecycle, transport, every matrix row, evidence limits, CI and handoff map to Tasks 1–4. All five Review Focus conditions have owning tests. Interfaces keep admin credentials in the controller and tokens in session closures; later tasks use the same names. No production behavior/schema change is planned. Exact Supabase start/status/stop flags were checked against installed CLI 2.119.0; actual container compatibility, short-lifetime behavior and revocation outcomes remain assertions to execute in CI, never assumed passing.
