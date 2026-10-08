# VOLO-148 Invitation Issuance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let current active admins issue a specific-email invitation with durable reservation, owned Auth identity and safe provider outcomes.

**Architecture:** Three short service-only database transactions reserve a send, bind its newly created subject and record its outcome. A server-only mutation policy coordinates those transactions with bounded Supabase Admin calls. The existing disposable Auth/mail stack proves provider behavior without hosted writes.

**Tech Stack:** Next.js 16.3.8, TypeScript, Supabase JS 2.117.2, Supabase CLI 2.119.0, PostgreSQL 17, node:test and pgTAP.

**Spec:** [Approved design](../specs/2026-10-08-volo-148-invitation-issuance-design.md).

## Global Constraints

- Use `feature/` branches.
- Tests write only to owned disposable local/CI services.
- There is no staging environment.
- Invitations do not expire with age.
- Issuance never inserts membership, confirms email, promotes a role, resets a password or re-enables an existing account.
- Keep provider calls outside transactions.
- Started and unknown attempts remain blocked regardless of elapsed time.
- Privileged keys remain server-only and are unnecessary for ordinary app builds.
- Do not change hosted templates or redirect allowlists.
- Do not hand-edit generated function declarations.
- No hosted migrations, real invitations, production publishing, new dependencies, second stack, queue or retry engine.
- Preserve untracked `docs/audits/`; stage only this ticket's files.

## Review Focus

- Admin disabled after reservation: stop before the next provider call; retain durable evidence (Tasks 1–2).
- Provider succeeds but its response body stalls: deadline covers body reading and outcome stays uncertain (Task 2).
- Account appears between reservation and creation: reject without inviting or changing that account (Tasks 2–3).
- A replay changes requester or email spelling: equivalent normalized email with the same requester replays; a different requester/key conflicts (Task 1).
- Cancellation after subject creation: cleanup touches only owned rows, observes RESTRICT dependencies and preserves other runs (Task 3).

## File responsibilities

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20261009010000_invitation_issuance_functions.sql` | Three hardened service-only transactions |
| `supabase/tests/database/invitation_issuance.test.sql` | Function grants, transitions and idempotency |
| `lib/supabase/database.types.ts` | Pinned CLI output only |
| `lib/auth/invitation-issuance.ts` | Strict request policy and fresh admin authorization |
| `lib/auth/invitation-send.ts` | Small initial-send state machine and typed internal ports |
| `lib/auth/invitation-send-provider.ts` | Supabase RPC/Admin adapter, deadlines and safe classification |
| `tests/invitation-send.unit.mts` | State-machine failure cases and HTTP adapter behavior |
| `package.json`, `.github/workflows/ci.yml` | Register focused unit command in current validation job |
| `supabase/templates/invite.html`, `supabase/config.toml` | Local direct application invite link |
| `tests/helpers/local-auth-stack.mjs`, `tests/local-auth-stack.test.mjs` | Owned secret/mail/template access and dependency-aware cleanup |
| `tests/helpers/real-auth-app.mjs` | One guarded invitation fixture endpoint in the existing build |
| `scripts/verify-auth-integration.mjs` | Real admin issuance and captured mail scenarios |
| `docs/auth-callbacks.md`, `docs/session-integration.md` | Local verification and hosted enablement boundaries |

Read the installed Next.js data-security and route-handler guides before touching
product code. Read the spec and existing invitation migration before SQL changes.
Use the existing feature branch, with worktree isolation evaluated by the worktree
skill at execution time. Do not discard or duplicate the committed spec.

### Task 1: Durable issuance transactions

**Interfaces:** SQL functions use snake_case; TypeScript ports use camelCase.
All SQL functions return `jsonb`, decoded strictly in Task 2.

- `reserve_invitation_send(p_operation_id uuid, p_recipient_email text, p_requester_id uuid)`
  → `{code:'reserved', invitation_id, attempt_id, version:1, recipient_email, fresh:boolean, outcome}`
  or `{code:'denied'|'conflict'|'invalid_input'}`. Attempt ID equals operation ID.
  On replay, retain the original trimmed delivery spelling; comparison uses the normalized key.
- `bind_invitation_send_subject(p_attempt_id uuid, p_expected_version bigint, p_requester_id uuid, p_subject_id uuid)`
  → `{code:'bound'|'denied'|'stale'|'conflict'}`.
- `record_invitation_send_outcome(p_attempt_id uuid, p_expected_version bigint, p_outcome text, p_subject_id uuid, p_error_code text)`
  → `{code:'recorded'|'stale'|'conflict'}`. Subject/error arguments are nullable.
  Outcomes are accepted/rejected/unknown; error values use the existing enum whitelist.

- [ ] Write pgTAP tests in `supabase/tests/database/invitation_issuance.test.sql` with rollback-only fictional Auth/admin fixtures. Pin these assertions:

  ```sql
  -- Reservation returns a fresh version-1 initial/started attempt.
  select is((public.reserve_invitation_send(op,email,admin)->>'fresh')::boolean,true);
  -- Same requester + normalized email replays; another requester/key conflicts.
  select is((public.reserve_invitation_send(op,upper(email),admin)->>'fresh')::boolean,false);
  select is(public.reserve_invitation_send(op,other_email,admin)->>'code','conflict');
  ```

  Use named fixture constants/temporary helpers for the abbreviated identifiers.
  Also assert denied inactive/non-admin requesters, existing confirmed/unconfirmed
  Auth email or operation UUID, missing/mismatched subject, existing membership,
  stale/terminal binding, accepted-without-binding denial, old timestamp validity,
  first-outcome preservation, identical finalization replay and conflicting repeat.
  Check PUBLIC/anon/authenticated lack EXECUTE and service_role has it. Verify
  unchanged membership rows and no browser table permissions.
- [ ] Run `npm run db:test` on the owned local stack where Docker exists. Expect missing-function failures before implementation. On this workstation, retain the test-first diff and record that execution requires existing database CI; do not claim a red run occurred.
- [ ] Implement the three functions in the new migration. Serialize operation UUID reservations with a transaction advisory lock; use existing live-email uniqueness for different operations. Check for replay before rejecting the account this operation may already have created. Compare immutable requester and normalized email on replay. Fresh reservation requires no matching Auth account and no existing proposed subject UUID. Return conflict for uniqueness races without exposing raw SQL errors.
- [ ] Implement binding with invitation-then-attempt locks, matching initial attempt/requester/version, current admin, pending live state and exact subject ID equal to attempt ID. Check Auth email and absence of membership before setting `auth_user_id`; never rebind. Make an identical binding replay harmless.
- [ ] Implement outcome recording under the same lock order. Permit first history recording after permission loss or terminal transition, returning stale when the invitation cannot advance. Accepted requires the recorded subject to match the bound subject; it advances only the matching pending generation. Preserve first outcomes and do not fill reconciliation fields. Add hardened search paths and explicit grants/revocations.
- [ ] Run seeded and unseeded database tests and the existing upgrade-preservation script. Expect all pgTAP assertions and upgrade checks to pass.
- [ ] Generate types with `npm run db:types`; run `npm run db:types:check`. Without Docker, obtain the exact `database-types` artifact from the existing database CI, commit it unchanged and rerun CI; never fabricate the declarations. The first CI pass may intentionally report stale types.
- [ ] Commit migration, SQL tests and generated types as `feat: reserve and finalize invitation issuance transactions`.

### Task 2: Guarded server-only send orchestration

**Interfaces:** Define these types in `lib/auth/invitation-send.ts`:

```ts
type SendCommand = Readonly<{operationId:string;recipientEmail:string;requesterId:string}>;
type SendResult = Readonly<{code:'accepted'|'rejected'|'conflict'|'pending_reconciliation'|'unavailable'}>;
type Reservation =
  | {code:'reserved';invitationId:string;attemptId:string;version:number;recipientEmail:string;fresh:boolean;outcome:'started'|'accepted'|'rejected'|'unknown'}
  | {code:'denied'|'conflict'|'invalid_input'};
type ProviderIdentity = {subjectId:string;email:string};
type ProviderResult = {code:'accepted';identity:ProviderIdentity}
  | {code:'rejected'|'unknown';errorCode:'timeout'|'provider_rejected'|'rate_limited'|'provider_unavailable'|'identity_conflict'|'unknown'};
```

`InitialSendPorts` has `currentAdmin(requesterId):Promise<boolean>`,
`reserve(command):Promise<Reservation>`,
`createSubject(operationId,email):Promise<ProviderResult>`,
`bind(reservation,requesterId,subjectId):Promise<'bound'|'denied'|'stale'|'conflict'>`,
`invite(email):Promise<ProviderResult>`, and
`record(reservation,outcome,subjectId,errorCode):Promise<'recorded'|'stale'|'conflict'>`.
Failures of authority reads throw sanitized unavailable errors rather than false.
Use the concrete types above for parameters, including nullable subject/error on
record. These internal ports are a test seam, not a pluggable provider framework.

`executeInitialInvitation(command:SendCommand,ports:InitialSendPorts):Promise<SendResult>`
is an internal server-only function. `invitationIssuancePolicy():MutationPolicy<{email:string},SendResult>`
is the reusable guarded entry point in `lib/auth/invitation-issuance.ts`; it generates
the operation UUID inside the authorized effect and never accepts client authority.
`createInitialSendPorts():InitialSendPorts` in the provider module supplies real dependencies.

- [ ] Write `tests/invitation-send.unit.mts` using node:test and small port fakes. Assert the successful trace is `admin,reserve,create,bind,admin,invite,record`; create uses the operation UUID and accepted matches both UUID and normalized email. Assert missing initial admin yields zero privileged calls.
- [ ] Add table-driven failure tests: replay of each durable outcome never creates/sends; duplicate creation rejects without invite; lost create response records unknown; failed binding never invites; lost admin after binding never invites; invite subject/email mismatch is unknown; accepted provider result plus failed/stale record returns pending_reconciliation. No branch retries or deletes a user. Failures before reservation are unavailable; failures after a durable reservation do not suggest a safe retry.
- [ ] Run `node --conditions=react-server --test tests/invitation-send.unit.mts`; expect missing module/export failure before implementation.
- [ ] Implement the state machine with those interfaces. Map reservation conflict to conflict and denied/invalid_input to rejected, with zero provider calls. Persist each observed result once. A known no-send denial after creation is rejected with retained ownership; an uncertain provider effect is unknown. If recording fails, leave started durable and return pending_reconciliation. A durable accepted replay returns accepted; rejected replay returns rejected; started/unknown replay returns pending_reconciliation.
- [ ] Add adapter tests with a controlled HTTP transport. Assert malformed RPC data, oversized/unsafe versions, 5xx, unexpected identity, thrown transport errors and unknown error codes cannot produce accepted. Recognize duplicate-account errors only at creation as known no-send rejection. Recognize invite rejection codes only when pinned provider behavior proves no send; otherwise classify unknown. Test both stalled headers and stalled bodies, and a redirect target that must receive zero requests.
- [ ] Implement the adapter using the pinned SDK, disabled session persistence/refresh, `.retry(false)` for RPC and a 5,000 ms deadline per call including response body buffering. Never log response bodies. Send `createUser({id:operationId,email,email_confirm:false})`, then `inviteUserByEmail(email,{redirectTo:fixedConfirmUrl})`. Derive fixedConfirmUrl from validated `VOLO_MUTATION_ORIGIN` plus `/auth/confirm`. Strictly decode RPC payloads and SDK user results. Reuse fresh `getAccess()` for currentAdmin, requiring matching requester ID, active admin membership and verified identity.
- [ ] Implement the mutation policy with `allowedRoles:['admin']`, exact email-only input shape, ASCII/length/syntax validation and ASCII canonical comparison. Reject role, requester, operation ID, redirect and duplicate form fields through existing readers/policy. Do not export a deployed route or change existing guards. Keep all new modules `server-only`.
- [ ] Register `test:invitations:unit` in package.json and run it in the existing validate CI job. Run it locally, plus `npm run test:mutations:unit`, `npm run test:access:unit`, typecheck and lint. Expect passing assertions and no type/lint errors; ordinary builds require no privileged secret.
- [ ] Commit service, policy, unit coverage and command registration as `feat: issue invitations through the admin mutation guard`.

### Task 3: Prove real Auth and captured-mail behavior

**Interfaces:** Extend existing helpers, preserving callers where possible:

- `startLocalAuthStack({repositoryRoot,stateFile?,jwtExpirySeconds?,signal?,applicationOrigin})` accepts an exact owned `http://127.0.0.1:<port>` origin.
- `startRealAuthApp({repositoryRoot,stack,signal,applicationOrigin})` starts its existing fixture on that same reserved port.
- Stack exposes `serverSecret` only to the Node-owned fixture launcher, registers it for leak checks, and never writes it to ownership state or summaries.
- Add owned test methods `readInvitationForEmail(email)`, `readSendAttempts(invitationId)`, `readCapturedInvites(email)` and `trackIssuedSubject(id)`; validate ownership before reads/cleanup. Captured mail stays in memory and token hashes are added to leak canaries immediately.
- Extend `createAccount` with `emailConfirmed?:boolean` (default true) to exercise an existing unconfirmed identity without changing ordinary fixtures.

- [ ] Extend helper unit tests first: reject non-owned application origins/mail destinations; copy the template into the temporary stack; require a modern `sb_secret_` key; redact that key in fixture startup failures; preserve the original admission policy; leave another run's state untouched. Pin cleanup ordering attempts → invitations → memberships → Auth users, cancellation after creation, idempotent cleanup and no broad Docker operation.
- [ ] Run `node --test tests/local-auth-stack.test.mjs`; expect assertions for new behavior to fail.
- [ ] Configure `supabase/templates/invite.html` and the local `[auth.email.template.invite]` section. Use the HTML-escaped link `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=invite`. Preallocate the app port in the controller, pass its origin through both helpers and add only the exact `/auth/confirm` redirect in the disposable config. Copy the fixed template path into the temporary stack.
- [ ] Read the pinned CLI status modern secret and owned SMTP capture destination; validate the latter against the port allocated from that run's config. Use the actual pinned capture API, with bounded reads and no redirect following. Fail sanitized if runtime fields/behavior differ. Never read a developer .env or substitute a hosted key.
- [ ] Implement owner-scoped teardown using the owned stack's local PostgreSQL owner access for invitation dependencies; do not grant DELETE to service_role. Track each created or possibly-created operation UUID for cleanup. Preserve cleanup state on failure and existing `--cleanup` behavior. Run helper tests; expect pass.
- [ ] Add `/api/invitations` only to the compiled test fixture, calling the existing route mutation wrapper with Task 2's policy. Supply the modern secret only to its server process. Include it in diagnostic redaction and static asset leak scanning. Keep the existing outbound allowlist and single build.
- [ ] Add `invitation_issuance_authorization`, `invitation_issuance_mail`, `invitation_existing_accounts` and `invitation_parallel_reservations` scenarios to the current integration controller. Assert signed-out/member/disabled/stale-admin/wrong-origin requests produce no invitation or mail; a valid admin produces one issued row, accepted attempt, unconfirmed exact UUID subject and zero membership; captured URL has exact origin/path, token_hash and type=invite and is never fetched. Do not put token material in summary evidence.
- [ ] Test trimmed/mixed-case duplicate rejection and distinct dot/plus identities against real Auth. Snapshot existing confirmed/unconfirmed/disabled users and memberships before attempting issuance; assert unchanged snapshots and no captured invite. Exercise duplicate creation racing after reservation through the internal service with owned real dependencies; assert no invite for the preexisting winner. Stop and revise the reviewed contract if real provider normalization disagrees.
- [ ] Exercise simultaneous normalized-email requests with `Promise.all`; assert one accepted result, one durable live row/attempt/subject and one captured mail. Validate repeated operation IDs via service-only RPC/state-machine coverage without exposing caller-selected operation IDs on the route. Keep failure injection in deterministic unit tests, not production switches.
- [ ] Run `npm run test:auth:integration` where Docker exists. Expect the new scenarios and all existing Auth scenarios to pass, including credential leaks and cleanup. Locally record Docker unavailable; use the established CI job as required acceptance evidence.
- [ ] Update callback/session documentation with local template behavior, create-before-invite ownership, accepted-versus-delivered semantics and the separate hosted enablement requirement. Run unit commands, typecheck, lint, build, existing repository tests and `git diff --check`.
- [ ] Commit harness, template and documentation as `test: verify durable issuance with real Auth and captured mail`.

## Whole-branch verification and handoff

- [ ] Use one fresh whole-branch reviewer under the selected execution workflow. Review account ownership, duplicate-send prevention, privilege boundaries, ambiguous outcomes and cleanup; address actionable findings and rerun affected checks.
- [ ] Confirm all three existing CI jobs pass on the final commit, including regenerated-type drift checks. Record exact run/commit and sanitized new scenario results. A draft PR may be needed to run existing pull-request CI; attach any created PR to this chat and retain the established production publishing lock.
- [ ] Report implemented behavior, verification evidence and the remaining VOLO-149/122 work. Do not declare a hosted invitation flow available or mark parent VOLO-29 complete while VOLO-149 remains.

## Execution handoff

Preserve Roger's previously selected **Native** execution approach: implement the
tasks in this session, then obtain one independent whole-branch review. This is
appropriate because these three tasks share transactional and provider interfaces.
Wait for review of this written plan before implementation, then invoke
`superpowers:executing-plans`.
