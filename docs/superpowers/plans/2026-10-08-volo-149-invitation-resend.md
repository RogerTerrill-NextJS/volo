# Fenced Invitation Resend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renew an eligible invitation for its existing Auth subject, fence old setup authority, and explicitly reconcile trustworthy send outcomes.

**Architecture:** Extend the existing service-only SQL and guarded invitation mutation boundary. Keep provider calls outside transactions; add one small proof table for single-use generation-bound resume authority. Reuse the existing real Auth/mail stack and CI jobs.

**Tech Stack:** Next.js 16.3.8, TypeScript, Supabase JS 2.117.2, CLI 2.119.0, PostgreSQL 17, node:test and pgTAP; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-08-volo-149-invitation-resend-design.md` (approved).

## Global Constraints

- Use `feature/` branches.
- Invitations never expire by age.
- Acceptance means accepted for sending, not delivery.
- No staging, hosted migrations, real email, hosted account or Auth changes, or production publishing.
- Previews share production Supabase; all write tests use owned disposable local/CI services.
- Keep production publishing locked.
- Do not introduce queues, background workers, automatic retries, timed takeover, an email delivery service or a second integration harness.
- Never create a replacement account or clear confirmation to make the invite endpoint accept the request.
- Regenerate types with the pinned CLI; do not hand-edit generated declarations.
- Local Docker is unavailable; real database/provider execution must pass in the existing CI before completion.
- Preserve unrelated untracked `docs/audits/`.

## Review Focus

- Confirmation changes during renewal: do not fall back to another send; uncertain results stay pending (Task 2).
- Recovery returns HTTP success for a missing account: exact subject/email verification must still fail closed (Tasks 2–3).
- Provider drops callback query parameters: absence of the opaque proof makes renewal unusable and fails the real acceptance test (Task 3).
- Conflicting late outcome after explicit reconciliation: retain one resolution without reopening eligibility (Task 1).
- Proof consumption races with resend: only a current generation can consume; future setup must compose in the same transaction (Tasks 1–3).

## File map and execution conventions

Task 1 owns the new SQL migration/test, existing upgrade verifier and generated types.
Task 2 owns `lib/auth/invitation-resend.ts`, its focused unit test, and targeted
extensions to the existing provider/policy files. Task 3 owns local templates,
fixture/harness integration and contract documentation. Do not restructure unrelated
Auth code or build an additional generic provider framework.

Use the existing checkout on `feature/volo-149-invitation-resend` unless Roger
requests a worktree. Preserve the earlier Native execution preference: implement
inline, then one fresh whole-branch reviewer. Implementation starts only after
Roger reviews this plan. Read installed Next guides before code changes:
`node_modules/next/dist/docs/01-app/02-guides/data-security.md`,
`node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`,
and `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`.

Local commands use the pinned Node executable:
`/Users/rogerterrill/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`
(abbreviated `NODE` below; replace literally, not with an assumed PATH entry).
Use fixture public config for offline checks. Run build/type generation sequentially
to avoid `.next` races. CI uses the existing locked npm scripts unchanged except
the invitation unit-test file list.

### Task 1: Transactional resend, proof and reconciliation fences

**Files:**
- Create: `supabase/migrations/20261009020000_invitation_resend.sql`
- Create: `supabase/tests/database/invitation_resend.test.sql`
- Modify: `scripts/verify-invitation-upgrade.mjs`
- Generate: `lib/supabase/database.types.ts`

**Interfaces:**
- Consume existing invitation/attempt enums, membership checks, initial reservation and outcome functions.
- Add `reserve_invitation_resend(p_operation_id uuid,p_invitation_id uuid,p_expected_version bigint,p_requester_id uuid) returns jsonb`.
- Reserved JSON extends the existing shape with `subject_id`; denial codes are `denied`, `conflict`, `stale`, `pending_reconciliation`, `invalid_input`. Preserve replay `fresh=false` and durable outcome/resolution.
- Add `invitation_send_proofs(attempt_id uuid primary key references invitation_send_attempts(id),secret_digest text,transport text,consumed_at timestamptz)`; digest is exactly 64 lowercase hex, transport exactly `invite` or `recovery`. Revoke client access; no client policies or raw secret.
- Add `prepare_invitation_send_proof(p_attempt_id uuid,p_expected_version bigint,p_requester_id uuid,p_subject_id uuid,p_secret_digest text,p_transport text) returns jsonb`: `prepared|denied|stale|conflict`.
- Add `consume_invitation_send_proof(p_attempt_id uuid,p_expected_version bigint,p_verified_subject uuid,p_secret_digest text,p_transport text) returns jsonb`: `consumed|stale|conflict`. Internal server-verified arguments only; no public mutation. Future setup SQL calls it within the same transaction that creates setup authority.
- Add `reconcile_invitation_send(p_attempt_id uuid,p_expected_version bigint,p_requester_id uuid,p_outcome text,p_subject_id uuid) returns jsonb`: `reconciled|denied|stale|conflict`. Only trusted server-observed accepted/rejected evidence reaches it.
- Extend `record_invitation_send_outcome` for resend identity and reconciliation consistency while preserving initial checks.

- [ ] Write rollback-only pgTAP tests using fictional Auth/membership rows. Assert version+1, same subject/inviter, different requesting admin, cleared setup/password fields, unresolved blocking, old-age eligibility, terminal denial, replay/conflict, proof constraints/grants and single use. Pin these specific cases:

```sql
-- With an accepted version-1 attempt, reserve version 2 exactly once.
select is((public.reserve_invitation_resend(op,inv,1,admin)->>'version')::bigint,2::bigint);
select is(public.reserve_invitation_resend(op,inv,1,admin)->>'fresh','false');
-- Fixture variables above stand for explicit fictional UUIDs in the test.
-- Resend invalidates version-1 proof, including concurrent consumption.
-- Reconcile unknown as accepted; contradictory late rejected outcome conflicts.
-- Terminal reconciliation may finish history, but status stays terminal.
```

- [ ] Run the test against the old schema in the existing disposable database CI; missing function/table failures establish RED. A draft PR may be used to obtain CI evidence; attach it to this chat. Keep it draft until full validation/review. No local Docker substitute or hosted execution.
- [ ] Implement the migration with invitation-then-attempt locking, operation serialization, strict null/version/overflow checks, active-admin checks and existing Auth identity restrictions. Reserve atomically clears snapshots and old proofs. Prepare proof before external send; a conflicting existing proof never authorizes another send. Consumption requires issued current generation, matching subject, no membership and unconsumed digest/transport. Reconcile records separate resolution/time and advances only current live bound acceptance; an initial absent subject may bind only its reserved UUID under the existing restrictions. No provider inspection in SQL beyond local authoritative Auth rows.
- [ ] Extend the upgrade verifier's exact migration allowlist and expected history with `20261009020000`. Obtain GREEN pgTAP with seeded/unseeded rebuilds and the prior-schema upgrade through the existing job. Copy the unmodified generated public-schema types from its artifact; repeat CI type comparison until it passes. A missing/stale-type intermediate failure is expected, not completion.
- [ ] Commit only these files: `feat: add fenced invitation resend persistence`.

### Task 2: Guarded renewal and trustworthy outcome reconciliation

**Files:**
- Create: `lib/auth/invitation-resend.ts`
- Create: `tests/invitation-resend.unit.mts`
- Modify: `lib/auth/invitation-send-provider.ts`, `lib/auth/invitation-issuance.ts`, `lib/auth/invitation-send.ts` (shared types only where needed)
- Modify: `package.json` (`test:invitations:unit` includes both unit files)

**Interfaces:**
- `ResendCommand = {operationId:string;invitationId:string;expectedVersion:number;requesterId:string}`.
- `ResendReservation` extends reserved-send fields with `subjectId:string`; preserve captured version and effective replay resolution.
- `ResendPorts`: `currentAdmin(id)`, `reserve(command)`, `inspectSubject(subjectId)`, `prepareProof(reservation,requesterId,digest,transport)`, `send(reservation,transport,secret)`, `record(...)`. Use explicit typed safe unions matching Task 1; `inspectSubject` returns validated `{subjectId,email,confirmed,banned}` or unavailable/missing. Membership and authoritative email checks also remain in the SQL fences.
- Port methods return promises: `currentAdmin(string):boolean`; `reserve(ResendCommand):ResendReservation|{code:'denied'|'conflict'|'stale'|'pending_reconciliation'|'invalid_input'}`; `inspectSubject(string):{code:'found';subjectId:string;email:string;confirmed:boolean;banned:boolean}|{code:'missing'|'unavailable'}`; `prepareProof(ResendReservation,string,string,'invite'|'recovery'):'prepared'|'denied'|'stale'|'conflict'`; `send(ResendReservation,'invite'|'recovery',string):ProviderResult`; `record(ResendReservation,'accepted'|'rejected'|'unknown',string|null,SafeSendError|null):'recorded'|'stale'|'conflict'`. ProviderResult/SafeSendError reuse `invitation-send.ts`.
- `executeInvitationResend(command:ResendCommand,ports:ResendPorts):Promise<SendResult>`; add safe `stale` result only if required, keeping consumers explicit.
- `createResendPorts():ResendPorts` reuses the existing lazy bounded privileged client conventions.
- `invitationResendPolicy():MutationPolicy<{invitationId:string;expectedVersion:number},SendResult>` accepts exactly those two keys and generates trusted operation/requester IDs.
- `inspectInvitationSend({invitationId,expectedVersion,requesterId},ports)` returns only safe known/pending/conflict/unavailable state, without provider writes.
- `reconcileInvitationSend({attemptId,expectedVersion,requesterId},observation,ports)` accepts only internal trusted provider observation, verifies exact attempt/identity and active admin, then calls Task 1 reconciliation. Never expose `observation` through a request parser or accept arbitrary resolution from a browser.
- `TrustedSendObservation = {outcome:'accepted';identity:ProviderIdentity}|{outcome:'rejected';errorCode:SafeSendError}`; these values originate only from the controlled provider adapter's actual response, not from persisted email/timestamp guesses. Inspection ports load the exact invitation/attempt snapshot and return sanitized known/pending state; reconciliation ports load that snapshot, verify current admin and identity, and return SQL `reconciled|denied|stale|conflict`. Both operations return `Promise<{code:'accepted'|'rejected'|'pending_reconciliation'|'conflict'|'unavailable'}>`.

- [ ] Write focused failing unit tests for these boundaries. Reuse existing initial tests rather than copying them. Pin:

```ts
// Local harness implementations belong in the test file.
assert.equal((await run({confirmed:false})).code,'accepted');
assert.equal(sentTransport,'invite');
assert.equal((await run({confirmed:true})).code,'accepted');
assert.equal(sentTransport,'recovery');
assert.equal(createAccountCalls,0);
assert.equal(rawSecretBytes,32);
assert.match(storedDigest,/^[0-9a-f]{64}$/);
// Also assert replay/denial performs zero sends; prepare failure sends zero times;
// lost record/transport/missing post-send subject returns pending reconciliation;
// a confirmation-state change causes no fallback send; inspection never resolves
// by timestamp/email, and trusted reconcile cannot accept a different subject.
```

- [ ] Run `NODE --conditions=react-server --test tests/invitation-resend.unit.mts`; confirm behaviorally relevant RED before product code.
- [ ] Implement the narrow orchestration and adapter. Generate `randomBytes(32).toString('base64url')` and SHA-256 digest; select transport from validated confirmation state, commit proof, recheck admin, send once, validate exact subject/email, record. Recovery uses `auth.resetPasswordForEmail(email,{redirectTo})` without updating password; callback adds only the server-generated resume secret to the fixed `/auth/confirm` origin/path. No provider fallback or blind retry. Keep safe results, strict RPC shape validation and no secret output. Reuse the existing client factory through a small internal helper if needed; avoid duplicating timeout/credential handling.
- [ ] Implement guarded inspection and internal trustworthy-observation reconciliation. Lost evidence remains unresolved. Validate subject ownership independently of outcome; no email/timestamp heuristic or client-selected resolution. Preserve first outcome/resolution rules in SQL.
- [ ] Run both invitation unit files, TypeScript and lint with the existing offline config. Inspect request assertions for exact callback, payload, no password/metadata changes, no automatic SDK retries, response-body deadlines and missing-user HTTP-success handling. Keep existing initial tests passing.
- [ ] Commit the service, adapter/policy and unit checks: `feat: renew invitations with version-bound resume proof`.

### Task 3: Real provider evidence, cleanup and contract alignment

**Files:**
- Modify: `tests/helpers/local-auth-stack.mjs`, `tests/helpers/real-auth-app.mjs`, `scripts/verify-auth-integration.mjs`, `tests/local-auth-stack.test.mjs`
- Modify: `supabase/config.toml`, `supabase/templates/invite.html`
- Create: `supabase/templates/recovery.html`
- Modify: `docs/auth-callbacks.md`, `docs/session-integration.md`
- Modify relevant paragraphs in `docs/superpowers/specs/2026-10-07-volo-121-invitation-contract-design.md`, `docs/superpowers/specs/2026-10-07-volo-127-invitation-schema-design.md`, `docs/superpowers/specs/2026-10-08-volo-148-invitation-issuance-design.md`

**Interfaces:**
- Reuse existing `stack.readCapturedInvites(email)`, owned subject/email tracking and fixture `app.request`.
- Extend owned helper with local token verification and proof observation/consumption support needed for tests. Destination remains the exact owned loopback Auth API; register all returned credentials and email proof canaries for redaction/leak checks.
- Test-only fixture routes wrap real resend/inspection policy and controlled injected failures; no production routes, test flags or credential escape hatches.
- Local recovery template links directly to application callback with token hash, `type=recovery`, and preserved server-created proof. Keep invite type for initial/unconfirmed mail. Conditional resume copy must not mislabel ordinary recovery mail as an invitation.

- [ ] Add failing scenarios to the shared Auth script: issue→unconfirmed resend; consume actual owned invite token→confirmed resend; successful email without password/membership mutation; callback proof retained; proof single-use/stale/terminal denial; concurrent same-version resend; lost response and lost database recording remain pending. Compare exact subject IDs, version/attempt counts and captured email counts. No real HTTP confirmation route is implemented.
- [ ] Extend helper tests first for copying both templates, owned callback query preservation/redaction, and proof-before-attempt cleanup order. Run `NODE --test tests/local-auth-stack.test.mjs` for RED.
- [ ] Extend local config/templates and the existing fixture/helper only. Keep the successful single-DO owned cleanup implementation; delete proof rows before attempts rather than redesigning container discovery. Real token consumption happens only by explicit test POST to the owned provider, never a mail link GET.
- [ ] Run helper tests for GREEN, then the established `auth-integration` CI job. Verify token consumption retains the same Auth subject; recovery send does not change password hash or insert membership. A new token must be verifiable with its recorded type and matching proof. Compare role/ban/membership fields before/after. Pin missing-account recovery success and confirmation change as safe failure cases. Report only sanitized assertions/stages; add bounded diagnostics at the failing boundary before changing behavior.
- [ ] Align contract docs with the approved amendment: invite-only initial flow, both resend transports plus single-use proof, future atomic setup composition, no ordinary recovery authority, no guaranteed resolution after loss of all trustworthy evidence. Fix the earlier contradictory local email/config paragraph in `docs/session-integration.md`. No hosted instructions are executed.
- [ ] Run final checks sequentially: installed Next type generation and `tsc --noEmit`, ESLint, Next build, repository tests with fictional public env, both invitation unit files, and existing relevant boundary checks. Require final exact-HEAD CI database/upgrade/types, validation and real Auth jobs all green. Preview checks are anonymous/read-only only if needed; never substitute preview writes for disposable evidence.
- [ ] Commit: `test: verify invitation renewal and reconciliation boundaries`. Obtain one fresh whole-branch review under the preserved Native workflow, address material findings, rerun affected checks, then push and make the attached draft PR ready. Link exact-HEAD CI and concise evidence in Jira; keep ticket In Progress until Roger merges. Do not merge or publish production.

## Self-review and handoff

All spec sections map to Tasks 1–3; each Review Focus case has an owning check.
SQL signatures, transport values and digest encoding are consistent across tasks.
No new dependency, generic worker, public confirmation handler or deployment is
required. Generated types and real provider behavior remain explicit CI gates.
Preserve Native execution after Roger's review of this plan.
