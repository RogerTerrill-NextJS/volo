# Invitation confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Explicit invitation acceptance persists verified Auth cookies and a separate session-bound setup grant, without granting membership.

**Architecture:** One Node Route Handler transfers email verification material into encrypted Postgres transport, then verifies it only on an origin/CSRF-checked POST. A transaction records setup authority and consumes the current resend proof together. Existing Auth clients, guards, database and disposable integration fixture remain the foundation.

**Tech Stack:** Installed Next 16.3.8, React 19.2.8, Supabase JS 2.117.2/SSR 0.12.7, CLI 2.119.0, PostgreSQL 17, Node crypto and node:test; no new package dependencies.

**Spec:** [Approved VOLO-122 design](../specs/2026-10-09-volo-122-invitation-confirmation-design.md).

## Global Constraints

- Invitations never expire because of age; provider links, confirmation transport and setup authority have separate finite lifetimes.
- Transport expires after 10 minutes by database time; setup authority expires 30 minutes after database creation.
- Global maximum of 1,024 retained transports; at most 60 creations per minute per trusted origin, including claimed tombstones.
- AES-256-GCM, fresh 12-byte nonce, 32-byte lookup/CSRF secrets, SHA-256 digests, active plus at most one retiring 32-byte encryption key.
- Five-minute database cleanup schedule; test `pg_cron` availability and idle cleanup in the existing disposable database.
- Hosted opaque cookies: Secure, HttpOnly, SameSite=Lax, host-only, Path=/; explicit local loopback exception only.
- No membership at confirmation; password UI/activation/ordinary recovery remain VOLO-123/124/30/23.
- No hosted writes, key provisioning, provider settings, email sends or production publication; Deploy Previews and production only.
- Use `feature/volo-122-invitation-confirmation`, current checkout, native execution preference and one final independent review.
- Read relevant installed Next docs before product edits. Preserve unrelated `docs/audits/` and existing guarded flows.

## Review Focus

- Two tabs replace confirmation cookies: an old CSRF form must not consume the newer transport (Task 3).
- SDK writes session cookies before a later database failure: the failure response must clear newly issued cookies and grant no setup (Task 4).
- Renewal races acceptance: only the locked current generation/proof can create authority (Tasks 1, 5).
- Cleanup races a newer setup grant: expiry cleanup must not erase the newer correlation or terminal redemption evidence (Task 1).
- Abandoned GETs with no later traffic: physical encrypted-material cleanup must still run, with bounded storage (Tasks 1, 5).

## File map

- `supabase/migrations/20261009030000_invitation_confirmation.sql`: concrete stores, service RPCs and cleanup schedule.
- `supabase/tests/database/invitation_confirmation.test.sql`: grants, transport lifecycle, setup transaction and cleanup invariants.
- `lib/auth/invitation-confirmation-crypto.ts`: strict key configuration, opaque secret/digest and authenticated envelope only.
- `lib/auth/invitation-confirmation-store.ts`: bounded service-role adapters and minimal trusted result types.
- `lib/auth/invitation-confirmation.ts`: input parsing and confirmation orchestration, with concrete test ports.
- `lib/auth/invitation-setup.ts`: fresh verified session plus setup-store reader for downstream tickets.
- `app/auth/confirm/route.ts`: GET/HEAD/POST, clean HTML, private headers and writable cookies.
- Existing proxy matcher, database types, upgrade verifier, Auth fixture/scenarios, CI unit command and callback/configuration docs change only where this flow needs them.

### Task 1: transactional transport/setup storage and expiry cleanup

**Files:** Create migration and SQL test above. Modify `scripts/verify-invitation-upgrade.mjs`, `tests/helpers/local-auth-stack.mjs` cleanup, and regenerated `lib/supabase/database.types.ts`.

**Interfaces:**
- Create `create_invitation_confirmation_transport(p_lookup_digest text,p_csrf_digest text,p_origin text,p_expires_at timestamptz,p_key_id text,p_nonce text,p_ciphertext text,p_tag text,p_previous_digest text default null) returns jsonb`.
- Create `read_invitation_confirmation_transport(p_lookup_digest text,p_origin text) returns jsonb` and `claim_invitation_confirmation_transport(p_lookup_digest text,p_csrf_digest text,p_origin text) returns jsonb`.
- Transport results: `{code:'created'|'found'|'claimed',envelope?:{keyId,nonce,ciphertext,tag,expiresAt}}` or `{code:'denied'|'limited'}`; never return plaintext lookup/CSRF/provider secrets.
- Create `record_verified_invitation_setup(p_subject uuid,p_email text,p_session_id uuid,p_origin text,p_setup_digest text,p_invitation_id uuid,p_expected_version bigint,p_attempt_id uuid,p_resume_digest text,p_transport text) returns jsonb`.
- Setup result `{code:'recorded',authorizationId:string,expiresAt:string}` or `{code:'denied'|'stale'|'conflict'}`. Null attempt/resume are legal only for current accepted initial invite.
- Create `read_verified_invitation_setup(p_setup_digest text,p_subject uuid,p_email text,p_session_id uuid,p_origin text) returns jsonb`: `{code:'authorized',invitationId,version,authorizationId,expiresAt}` or `{code:'denied'}`.
- Create `cleanup_invitation_confirmation() returns void`, scheduled as `volo-invitation-confirmation-cleanup` with `*/5 * * * *`.

- [ ] Write SQL failing assertions for missing objects, anon/authenticated denial including application admin sessions, bounds/TTL and accepted initial setup with no membership.
- [ ] Run `npm run db:test` in owned local resources or existing disposable CI; confirm the new assertions fail against the current schema.
- [ ] Implement two RLS tables, indexed expiry/digests, restricted Auth/invitation FKs and service-only functions with fixed search paths. Create transport under an advisory lock, retain cleared tombstones for rate accounting and enforce origin/expiry/CSRF on claim. Validate supplied expiry is future and no more than 600 seconds from database time.
- [ ] Add assertions `61st creation -> limited`, retained-row `1025th -> limited`, two claims -> exactly one payload, wrong CSRF -> legitimate row still readable. Verify tombstone replacement cannot bypass accounting and expiry cleanup removes ciphertext without subsequent HTTP traffic.
- [ ] Implement setup transaction: lock invitation, check subject/email/state/version/current accepted attempt and no membership; for resend consume current unused matching proof inside the transaction. Replace one setup row, update verified snapshot/correlation, reset password evidence, return DB-generated 1800-second expiry.
- [ ] Add rollback and cleanup assertions: rejected insertion leaves resend proof unused; stale/revoked/redeemed/membership conflicts deny; old invitation succeeds; expired grant denies; cleanup cannot clear newer correlation or required terminal snapshots. Schedule only the named cleanup job and test its installation/execution.
- [ ] Update owned fixture deletion ordering and exact upgrade migration allowlists. Run seeded/unseeded SQL tests and upgrade preservation checks. Generate types using `npm run db:types`; use the existing CI-generated artifact if local Docker is unavailable, never handwritten schema types. `npm run db:types:check` must pass.
- [ ] Commit the tested migration, SQL assertions, fixture compatibility and generated types.

### Task 2: bounded encrypted envelopes and concrete store adapters

**Files:** Create crypto/store modules and `tests/invitation-confirmation-crypto.unit.mts`, `tests/invitation-confirmation-store.unit.mts`. Modify `.env.example`, `docs/environment-configuration.md` and package/CI unit invocation as needed.

**Interfaces:**
- `ConfirmationPayload={tokenHash:string;type:'invite'|'recovery';resume:string|null;csrf:string}`.
- Export `ConfirmationPayloadWithoutCsrf=Omit<ConfirmationPayload,'csrf'>` and `Binding={lookupDigest:string;origin:string;expiresAt:string}` from the crypto module.
- `ConfirmationEnvelope={keyId:string;nonce:string;ciphertext:string;tag:string;expiresAt:string}`; binding is `{lookupDigest:string;origin:string;expiresAt:string}`.
- `newConfirmationSecret():string`, `confirmationDigest(secret:string):string`, `sealConfirmation(payload:ConfirmationPayload,binding:Binding):ConfirmationEnvelope`, `openConfirmation(envelope:ConfirmationEnvelope,binding:Binding):ConfirmationPayload|null`.
- `createConfirmationStore()` returns async `create`, `read`, `claim`, `resolveInvitation`, `recordSetup`, `readSetup` adapters to Task 1 RPCs. `resolveInvitation({subject,email,resumeDigest,type})` yields `{code:'eligible',invitationId,version,attemptId:string|null}` or `{code:'denied'|'unavailable'}`; final authority always comes from the locked setup transaction.
- Initial resolution requires the latest accepted initial attempt. Resend resolution joins the current matching accepted attempt/proof. Bound all queries and emit only minimal fields.

- [ ] Write tampering tests: wrong digest/origin/expiry/tag/key, malformed/oversized envelope, absent/malformed keys all fail closed; active-key encryption and retiring-key decryption succeed. Assert no supplied secret appears in thrown errors.
- [ ] Run `node --conditions=react-server --test tests/invitation-confirmation-crypto.unit.mts`; observe failure before implementation.
- [ ] Implement Node AES-GCM with canonical encodings and AAD purpose/version plus digest/origin/expiry. Validate server-only `VOLO_CONFIRMATION_KEYS` at runtime without globally breaking unrelated routes. Token-hash parsing allows bounded ASCII provider hash text, at most 256 characters; resume/CSRF/cookie secrets require canonical 32-byte base64url encoding.
- [ ] Write adapter tests asserting exact RPC inputs, minimal projections, retry disabled, no-store, redirect refusal, malformed response denial and 5-second deadlines including stalled response bodies. Fixtures use fictional credentials only.
- [ ] Implement the concrete service adapters using existing privileged configuration; differentiate denial and service unavailability. Keep encryption and store access out of browser imports.
- [ ] Run crypto/store tests and relevant existing boundary tests. Document key format with placeholders only, 10-minute TTL, two-key rotation, cleanup verification and separately approved hosted provisioning. Commit.

### Task 3: non-consuming transport GET, clean form and strict POST input

**Files:** Create confirmation module/Route Handler and `tests/invitation-confirmation.unit.mts`. Modify `proxy.ts`, existing `scripts/verify-protected-app.mjs` public-boundary checks and `tests/helpers/real-auth-app.mjs` route copying.

**Interfaces:**
- `parseConfirmationLink(url:URL):ConfirmationPayloadWithoutCsrf|null` and `readConfirmationCsrf(request:Request):Promise<string|null>`.
- `createConfirmationTransport(input:ConfirmationPayloadWithoutCsrf & {origin:string;previousCookie:string|null},ports:TransportPorts):Promise<{code:'created';cookie:string}|{code:'denied'|'unavailable'}>` consumes Task 2 store/crypto; public result has no provider material.
- `TransportPorts` contains the concrete Task 2 store and `newSecret`, `seal`, `open`, `digest` functions with Task 2 signatures, plus `now:()=>number` for fixture time. Define it in the confirmation module, without a generic service abstraction.
- `GET(request:NextRequest)`, `HEAD(request:NextRequest)`, `POST(request:NextRequest)` exports; POST acceptance orchestration is completed in Task 4. Local exception uses the build-pinned loopback origin only.

- [ ] Write failing tests: no `verifyOtp` on GET/HEAD/prefetch; only normal valid token GET creates transport; duplicate/unknown/missing parameters, recovery without proof and over-2048-byte URL are rejected safely. Clean form contains CSRF only and no secret canaries.
- [ ] Run new unit tests before implementation and observe missing behavior failures.
- [ ] Implement token GET -> opaque cookie + fixed clean 303 redirect; clean GET -> escaped static accessible form. HEAD/prefetch cannot create transport. Apply private browser/CDN headers, no-referrer and CSP to every handler response; methods outside GET/HEAD/POST return private 405.
- [ ] Implement URL-encoded POST parsing with a streamed 1024-byte cap and 5-second body deadline, unique `csrf` field only, strict content-type/length checks and cancellation on failure. Reuse the exact build-origin/fetch-metadata guard before reading/claiming secrets.
- [ ] Exclude only `/auth/confirm` (including its permitted trailing-slash normalization) from proxy matching; prove other refresh boundaries remain covered. Add two-tab regression: replacing cookie makes old CSRF fail without consuming new transport.
- [ ] Run compiled fixture tests for headers, token-free clean response, method/parser denial, absent keys and non-consuming GET with preexisting expired Auth cookies. Commit the runnable non-consuming transport boundary; POST fails closed until Task 4.

### Task 4: provider verification, persisted session and setup grant

**Files:** Complete confirmation module/Route Handler; create setup reader module; extend unit and real Auth fixture/scenarios above.

**Interfaces:**
- `VerifiedConfirmation={subject:string;email:string;sessionId:string}` derives only from verified Auth evidence.
- `acceptInvitationConfirmation(input:{cookie:string;csrf:string;origin:string},ports:AcceptancePorts):Promise<{code:'accepted';setupCookie:string}|{code:'denied'|'unavailable'}>` claims Task 2 transport, verifies provider once, resolves invitation, calls eligibility and Task 1 setup transaction.
- `AcceptancePorts` extends `TransportPorts` with `verify:(payload:ConfirmationPayloadWithoutCsrf)=>Promise<{code:'verified';identity:VerifiedConfirmation}|{code:'denied'|'unavailable'}>` and `eligible:typeof readInvitationEligibility`. Route supplies the real writable Auth verifier; tests supply focused behavior without selecting caller authority.
- `getVerifiedInvitationSetup():Promise<{status:'authorized';invitationId:string;version:number;authorizationId:string;expiresAt:string}|{status:'denied'|'unavailable'}>` uses fresh request-scoped Auth evidence and Task 2 `readSetup`; never trusts general login or caller IDs.
- Route owns the existing writable Auth client's header sink and cleanup of newly issued Auth cookies on post-verification failure.

- [ ] Write orchestration tests proving wrong origin/CSRF never verify, concurrency claims once, unknown/provider failure never retries and DB failure yields no setup cookie. Observe failure before implementing acceptance.
- [ ] Implement `verifyOtp` using the retained type/hash, validate returned access token using `getClaims(token)` and `getUser(token)`, exact configured issuer, authenticated audience, future expiry, matching nonanonymous subject/email and UUID session ID. No claim is trusted through decoding alone. Use bounded Auth transport.
- [ ] Resolve current initial/resend generation and check existing `readInvitationEligibility`, then record setup under the transaction lock. Set opaque setup cookie only on committed success; clear transport and redirect only to `/account/setup`. On later failure clear newly issued Auth/setup cookies and return safe private failure.
- [ ] Implement setup reader requiring matching verified session, subject/email, origin, cookie digest, current invitation version/correlation and database expiry. No account/setup page, password mutation or membership insertion.
- [ ] Extend existing initial invitation and renewal scenarios through actual GET/clean GET/POST; prove fresh request observes Auth subject and authorized setup reader, while membership/dashboard still deny. Reuse owned mail links; replace direct provider verification where compatible rather than duplicating sends.
- [ ] Add a late-store-failure fixture injection around the real acceptance orchestrator, not a production bypass endpoint; assert error response contains no usable new Auth/setup cookies. Run unit/compiled/real Auth checks and commit.

### Task 5: concurrency, expiry and deployment handoff

**Files:** Extend existing SQL upgrade/concurrency verifier, real Auth scenarios, fixture secret redaction/cleanup, `docs/auth-callbacks.md` and `docs/preview-verification.md`.

**Interfaces:** Consumes all prior tasks; produces sanitized real-service evidence and exact-commit readiness only. No new public API.

- [ ] Add failing assertions for replay, ordinary recovery, stale original initial link after renewal, wrong verified session/subject/email, revoked/superseded/redeemed invitations and existing/disabled membership. Do not spoof provider claims as a positive real-service test.
- [ ] Add real overlapping transactions for two accepts and acceptance-versus-renewal; assert exactly one current setup authority, single proof consumption and no membership. Check cleanup-versus-new-setup correlation fencing and terminal snapshot preservation.
- [ ] Exercise transport/setup expiry with owned database time fixtures, both keys during rotation, ciphertext tampering, rate/storage limits and scheduled cleanup with no HTTP traffic. Capture sanitized outcomes, never raw URLs/cookies/tokens in artifacts.
- [ ] Extend existing leak scans for HTML/RSC, subsequent Location URLs, logs and static assets; permit intentional Set-Cookie delivery only. Clean owned transport/setup records before existing restricted invitation/Auth deletion; stop only owned resources even after failure.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`, relevant invitation/client/proxy/cache/boundary tests, database tests/upgrade/types check and `npm run test:auth:integration`. Where local Docker is unavailable, required database/provider gates run in existing disposable CI; no hosted substitute. Inspect every result and fix material failures.
- [ ] Document exact private route behavior, safe failure/retry instructions, VOLO-123 setup-reader handoff, cleanup job/key prerequisites and ingress token-log exclusion as a hosted activation gate. Commit documentation with final implementation.
- [ ] Request one whole-branch independent review; resolve material findings and rerun affected checks. Create/attach draft PR if not already used for CI/type generation; verify final-commit CI and preview before marking ready. Leave VOLO-122 In Progress until user merges; do not publish production.

## Self-review and execution handoff

Spec coverage: transport/limits/crypto/rotation -> Tasks 1–3; POST/Auth/cookies/setup/proof atomicity -> Tasks 1 and 4; failure/cleanup/concurrency/security evidence -> Tasks 1 and 5; hosted prerequisites and downstream ownership -> Tasks 2 and 5. Review-focus cases have explicit owning tests. Interfaces and TTL/limit values agree across tasks; no product code is part of this plan commit.

Preserve the user's native execution preference: implement inline in this chat,
with one final independent reviewer. Written-plan review remains required before
invoking `superpowers:executing-plans` and starting product implementation.
