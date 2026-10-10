# VOLO-124 Account Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. Preserve the user's native execution preference and one final independent reviewer.

**Goal:** Complete invited accounts safely through caller-session password setup, trusted password evidence, existing atomic redemption and fresh membership authorization.

**Architecture:** Extend the existing setup row and confirmation store with a small password reservation/evidence contract. A server-only orchestrator connects it to caller-session Auth; one POST Route Handler owns input, origin/CSRF validation, cookies, private headers and fixed redirects. No Auth request runs inside a SQL transaction.

**Tech Stack:** Next.js 16.3.8 installed guides, Supabase SSR 0.12.7/client 2.117.2, PostgreSQL 17, CLI 2.119.0, pgTAP and the existing disposable GitHub CI.

**Spec:** `docs/superpowers/specs/2026-10-09-volo-124-account-completion-design.md`

## Global Constraints

- Invitation age never expires eligibility; setup authority keeps its original 30-minute expiry.
- Never store passwords, Auth tokens or raw setup cookies; never trust a client success/identity/role assertion.
- Membership is created only by existing redemption; never upsert, promote or re-enable membership.
- Password uncertainty remains denied; a reservation is never automatically reclaimed to replay a mutation.
- Use current checkout and `feature/volo-124-account-completion`; preserve unrelated `docs/audits/`.
- No staging; production publishing stays locked. Hosted writes, migrations and production release need separate approval.
- VOLO-123 owns UI, VOLO-125 broader end-to-end scenarios, VOLO-126 handoff. Reuse existing harnesses and guards.
- Use the existing draft-PR CI path if Docker is unavailable locally; no hosted database substitute or new harness.

## Review Focus

- A provider response lost after a password write must not allow another concurrent password mutation (Task 2 uncertainty test).
- A record response lost after commit must not erase password evidence or repeat the password call (Tasks 1/2 record-release tests).
- Renewal/expiry during Auth work must prevent stale password evidence and membership admission (Tasks 1/2 stale-authority tests).
- A refreshed or replaced session must be persisted and reverified; an unpersisted session cannot complete (Task 2 real Auth test).
- Historical redemption with a now-disabled membership must not become current admission (Task 2 retry/access tests).

---

### Task 1: Restricted password reservation, evidence and store contract

**Files:**
- Create `supabase/migrations/20261010010000_invitation_password_completion.sql`.
- Create `supabase/tests/database/invitation_password_completion.test.sql`.
- Modify `scripts/verify-invitation-upgrade.mjs` for the new migration and reservation overlap proof.
- Generate `lib/supabase/database.types.ts` with the pinned CLI.
- Modify `lib/auth/invitation-confirmation-store.ts` and its existing unit test.

**Interfaces:**
- Consumes existing setup authorizations, invitation/password snapshots, verified Auth users/sessions, memberships and redemption.
- Add nullable `password_operation_id uuid` and `password_started_at timestamptz` to setup authorizations, with both-null/both-present constraint. No new table or expiry extension.
- Produce `begin_invitation_completion(p_operation_id uuid,p_setup_digest text,p_subject uuid,p_email text,p_session_id uuid,p_origin text) returns jsonb`.
- Produce `record_invitation_password(p_operation_id uuid,p_invitation_id uuid,p_expected_version bigint,p_setup_authorization_id uuid,p_setup_digest text,p_subject uuid,p_email text,p_session_id uuid,p_origin text) returns jsonb`.
- Produce `release_invitation_password` with the same SQL arguments as record.
- Export `CompletionContext={invitationId:string;version:number;authorizationId:string;setupDigest:string;identity:VerifiedConfirmation;origin:string}` and `CompletionStart={setupDigest:string;identity:VerifiedConfirmation;origin:string;operationId:string}`.
- Store `beginCompletion(input:CompletionStart)` returns `{code:'reserved'|'password_established'|'redeemed';invitationId:string;version:number;authorizationId:string}` or `{code:'busy'|'renew_required'|'denied'|'unavailable'}`.
- Store `recordPassword(input:CompletionContext & {operationId:string})` returns `{code:'recorded'|'denied'|'unavailable'}`. Store `releasePassword` takes the same input and returns `{code:'released'|'recorded'|'denied'|'unavailable'}`. Only recognized, validated results escape the store.

- [ ] **Step 1: Write failing SQL and store tests.** Use real setup fixtures and transaction rollback. Assert missing restricted functions; null/wrong subject/email/digest/session/origin/version/operation, expired authority/session, active ban, unconfirmed/anonymous Auth, existing membership and missing reservation deny without changing full fixture snapshots. Assert old invitation age remains eligible. Reserve once, assert second operation is busy and membership absent; record matching success, assert ordered password timestamp and idempotent repeat. Release wrong operation fails; release after recorded success reports recorded without clearing evidence. Successful release before evidence allows a new operation. Add malformed-result/transport failure tests to the existing store suite.

  Pin core outcomes independently:
  ```sql
  select is(pg_temp.begin_fixture()->>'code','reserved','first operation owns password step');
  select is(pg_temp.record_fixture()->>'code','recorded','matching operation records evidence');
  select is(pg_temp.release_fixture()->>'code','recorded','release cannot erase committed success');
  ```

- [ ] **Step 2: Observe RED.** Run `npm run db:test` on an owned disposable stack (or existing draft-PR CI); expect missing-function failure. Run pinned Node `--conditions=react-server --test tests/invitation-confirmation-store.unit.mts`; expect missing-method assertions. No product code before the corresponding failure is observed.
- [ ] **Step 3: Implement migration and minimal store methods.** Begin discovers invitation ID from the setup digest without taking an authority lock, then locks invitation before authority and rechecks the complete binding/current state. Service-role execution only, empty search path, qualified objects and explicit browser-role revokes. Reject conflicting memberships before a fresh reservation; allow authenticated historical redemption to return context without another reservation. Existing password evidence also skips reservation. An occupied reservation returns busy for its first 30 seconds, then renew_required; this is presentation only, never a lease release. Record/release recheck exact operation and current authority. Record moves setup_verified to password_established with an ordered server timestamp. Release clears only matching unevidenced reservations; recorded success returns recorded even if the caller lost that response. Never let release downgrade evidence or bypass current identity checks.
- [ ] **Step 4: Verify real overlap and exact types.** Extend the existing owned transaction helper: first reserve while holding the transaction, observe a second begin blocked on the invitation, commit, then assert the competitor is busy and no membership exists. Reuse existing renewal/cleanup/redemption proof; add a focused stale reservation assertion after renewal/expiry. Run seeded/unseeded `npm run db:test` and the upgrade verifier on its owned runner; expect every assertion and unchanged pre-existing Auth/member snapshots. Update both migration-history lists. Run `npm run db:types` and `npm run db:types:check`, or recover the CI types artifact and rerun its exact check; do not handwrite types.
- [ ] **Step 5: Commit the deliverable.** Run store tests, typecheck, lint and `git diff --check`; expect success. Commit only these persistence/store files with message `feat: reserve and record invitation password completion`.

### Task 2: Caller-session completion, native POST and focused integration

**Files:**
- Create `lib/auth/invitation-completion.ts`, `lib/auth/invitation-completion-auth.ts`, and `lib/auth/invitation-completion-input.ts`.
- Create corresponding `tests/invitation-completion*.unit.mts` files.
- Create `app/account/complete/route.ts`.
- Modify `lib/auth/invitation-setup.ts` for the UI's CSRF helper.
- Extend `scripts/verify-auth-integration.mjs`, `tests/helpers/real-auth-app.mjs`, and owned stack/session helpers only as needed for this boundary.
- Add completion unit files to existing `test:invitations:unit` in `package.json`.

**Interfaces:**
- Consumes Task 1 store methods/context and existing `redeem`, `verifyConfirmationSession`, `readInvitationEligibility`, `getAccess`, writable Supabase client and private-header/origin helpers.
- Produce `completionCsrf(cookie:string):string`, domain-separated `confirmationDigest('volo-completion-csrf-v1:'+cookie)`, and server-only `getInvitationCompletionCsrf():Promise<string|null>` for VOLO-123. Validate canonical opaque cookie before deriving; never return cookie or lookup digest.
- Produce `readCompletionInput(request:Request):Promise<{password:string;passwordConfirmation:string;csrf:string}|null>`. URL-encoded only, max 4096 body bytes, five-second read deadline, exactly those three nonduplicated fields, lowercase 64-hex CSRF. Equal passwords, at least eight Unicode code points and at most 256 UTF-8 bytes; never normalize/trim.
- Produce `completeInvitedAccount(input:{setupDigest:string;identity:VerifiedConfirmation;origin:string;password:string},ports:CompletionPorts):Promise<{code:CompletionCode}>`, where `CompletionCode='completed'|'password_rejected'|'retry_later'|'renew_required'|'access_denied'`.
- `CompletionPorts` supplies the store, `newOperationId():string`, existing eligibility function, `setPassword(password:string):Promise<{code:'updated'|'rejected'|'unknown'}>`, `verifyIdentity():Promise<{code:'verified';identity:VerifiedConfirmation}|{code:'denied'|'unavailable'}>`, and `access:typeof getAccess`.
- Produce `createCompletionAuthTransport():{fetch:typeof fetch;close():void;isUnavailable():boolean}` and caller-session `setInvitationPassword(client:{auth:Pick<SupabaseClient['auth'],'updateUser'>},password:string,expectedSubject:string,transport:ReturnType<typeof createCompletionAuthTransport>):Promise<{code:'updated'|'rejected'|'unknown'}>` using `auth.updateUser({password})`; transport is request-owned with a five-second body-inclusive deadline, no-store, redirect:error and no SDK mutation retries. Accept updated only for the verified subject's complete user response; unknown responses cannot become success. Characterize exact pinned provider rejection codes in real Auth tests before considering them definitive.
- `POST /account/complete` returns private 303 `/dashboard` only on completed. Semantic failures redirect to fixed `/account/setup?result=invalid_input|password_rejected|retry_later|renew_invitation|access_denied`. Invalid Origin yields private 403 without parsing passwords; unsupported methods yield private 405 without side effects.

- [ ] **Step 1: Write failing orchestrator, Auth transport and input tests.** Assert completed/historical retries invoke zero password mutations, and fresh completion calls reserve → eligibility → password → identity verification → record → redeem → fresh access in that order. Wrong authority/CSRF/input/Origin never calls Auth. Rejected password safely releases; unknown leaves reservation and yields renew_required. Record failure followed by release recorded resumes redemption without another mutation; release released permits retry_later; failed release requires renewal. Stale authority after Auth, wrong post-write identity, uncertain redemption and disabled/mismatched current access never succeed. Test exact eight-code-point/256-byte boundaries, duplicates, unknown fields, mismatch, malformed URL encoding, oversized/chunked body and deadline. Test transport timeout, malformed/mismatched user, 429/5xx and body stalls without retry or raw error exposure.
- [ ] **Step 2: Observe RED.** Run pinned Node `--conditions=react-server --test tests/invitation-completion*.unit.mts`; expect missing interfaces/behavior. Implement each behavior only after its specific failing assertion is observed.
- [ ] **Step 3: Implement the modules and POST route.** Re-read installed Next route-handler/cookie/security guides before application edits. Use typed ports as existing confirmation orchestration does, not a framework. Begin derives server context; eligibility applies to live states only, historical completion goes through redemption and fresh access. When password success is observed but record is unavailable, attempt exact-operation release/reconciliation; do not release unknown provider outcomes. Read fresh identity again after password update and require the same subject/email/session. Persist any SDK cookie writes through the existing response sink; never silently accept an unpersisted refresh. Ensure input validation, fixed origin and derived CSRF happen before Auth/store work. Keep raw passwords out of all return values, logs, query strings and RSC. Clear setup cookie only for verified completion; keep Auth cookies and database completion context for normal access/history checks.
- [ ] **Step 4: Extend the real owned Auth app and scenarios.** Copy the production completion route into the existing disposable app and provide a fixture-only setup form/CSRF reader, not production UI. Add tightly scoped fixture failure injection at Auth/evidence/redemption network boundaries and count actual password PUT requests, without logging bodies. Run real invitation confirmation then password completion; assert password login works for the same owned subject, one member created, private headers and cookie clearing. Replay a captured in-flight setup context and assert no second password PUT; disabling membership denies subsequent completion/access. Prove cross-origin/CSRF/missing setup denial, confirmed password rejection, lost password response denial, and success-record/redeem response-loss recovery. Reuse existing store/SQL proofs for the remaining branches instead of adding duplicate real Auth scenarios. Keep failure controls strictly in disposable test helpers.
- [ ] **Step 5: Run GREEN and the whole branch checks.** Run pinned Node completion/store tests, then existing `npm run test:invitations:unit`, typecheck, lint, production build and core `npm test`. On disposable CI run the existing database/upgrade/types and real Auth jobs as well. Expected: all final-head jobs and every required step succeed; record local tooling limitations explicitly. No preview write substitutes for local/CI proof.
- [ ] **Step 6: Commit and perform one final review.** Commit with `feat: complete invited accounts through verified password evidence`. Review the entire branch against the spec and five focus conditions, with one fresh read-only reviewer. Fix Critical/Important findings in one RED→GREEN pass and rerun required suites; record deferred minors and scope rulings. Update the existing draft PR with concise implementation and validation evidence. Keep VOLO-124 in progress until merge; parent VOLO-21 waits for its remaining subtasks. Do not merge, apply hosted migration or publish production.

## Execution handoff

Native execution in this session preserves the established user preference and avoids multiple implementers for tightly coupled security interfaces. One final independent review remains required. No implementation begins until the user reviews this plan.
