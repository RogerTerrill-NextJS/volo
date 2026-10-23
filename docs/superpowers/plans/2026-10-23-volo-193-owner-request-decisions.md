# Atomic Owner Request Decisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose an owner-only accept/decline RPC whose flight lock prevents oversubscription.

**Architecture:** Extend the existing request lifecycle with one restricted definer
RPC. Preserve the request trigger and closed direct member writes; reuse pgTAP,
the existing owned PostgreSQL concurrency barriers, upgrade verification and type generation.

**Tech Stack:** PostgreSQL 17, Supabase, pgTAP, Node.js, generated TypeScript database types.

**Spec:** `docs/superpowers/specs/2026-10-23-volo-193-owner-request-decisions-design.md`

## Global Constraints

- Use `feature/volo-193-owner-request-decisions` from merged VOLO-192 (`4018fab`).
- Derive the actor solely from `auth.uid()`; authenticated direct inserts/updates/deletes remain closed.
- Acquire the common flight `FOR UPDATE` lock before reading/updating the request.
- No terminal request is revived, and this operation cannot cancel acceptance.
- No new UI, privileged application client or hosted changes; VOLO-194 owns UI wiring.
- Preserve unrelated local `AGENTS.md` and `docs/audits/` changes.
- Run focused checks using owned local resources. Production publishing stays locked.

## Review Focus

- A request UUID from another owned flight cannot be decided through the wrong flight binding (Task 1).
- A matching retry after eligibility loss confirms history without changing timestamps (Task 1).
- A pending decline remains possible after requester disablement or flight closure (Task 1).
- An opposing stale decision cannot override the first decision on the same request (Task 2).
- Recipient removal racing acceptance cannot leave an accepted unselected requester (Task 2).

### Task 1: Guarded decision RPC and persisted contract

**Files:** Create `supabase/migrations/20261023010000_decide_flight_request.sql`
and `supabase/tests/database/flight_request_decisions.test.sql`.
Modify `lib/supabase/database.types.ts` and the expected migration list in
`scripts/verify-invitation-upgrade.mjs`.

**Interfaces:** Consumes existing `flights`, `flight_requests`, membership/profile/
recipient checks and the request trigger. Produces
`public.decide_flight_request(p_flight_id uuid,p_request_id uuid,p_decision text) returns jsonb`.
Valid decisions: `accepted`, `declined`. Confirmations:
`{code:'decided'|'already_decided',requestId:<bound UUID>,status:'accepted'|'declined'}`.
Failures: `{code:'request_unavailable'|'request_conflict'|'request_ineligible'|'capacity_full'}`.
Invalid input uses `22023`; missing identity, inactive actor, missing/foreign flight use `42501`.

- [ ] Write pgTAP cases using existing fictional request fixture patterns. Assert function/grants/search path;
  anonymous/service-role/disabled/unrelated-member/admin denial; null/unsupported input;
  missing and wrong-flight request binding; pending accept/decline; matching retry with
  unchanged complete row; opposing/withdrawn/cancelled conflict; original note/identity/creation
  preservation; open/future/active/licensed/PRIVATE checks; full capacity leaves pending;
  decline after target disablement/flight closure; and direct update denial.
- [ ] Start only the owned local PostgreSQL database and run the new test before adding
  the migration. Expected: missing RPC assertion fails. Record that evidence.
- [ ] Implement the exact RPC above using the existing submission security conventions,
  fully qualified objects and empty search path. Grant execute only to `authenticated`.
  Verify active owner, flight lock and bound request lock; return a matching no-op before
  acceptance eligibility checks. Only pending may transition. Acceptance checks eligibility
  and locked capacity; decline performs terminal closure. Update only status.
- [ ] Apply the additive migration locally. Run
  `node node_modules/supabase/dist/supabase.js test db --local supabase/tests/database/flight_request_decisions.test.sql supabase/tests/database/flight_requests.test.sql supabase/tests/database/flight_interest.test.sql supabase/tests/database/flight_recipients.test.sql`.
  Expected: all focused pgTAP assertions pass; no weakened assertions.
- [ ] Add `20261023010000` to the upgrade verifier's explicit version list. Run
  `node scripts/database-types.mjs` then `node scripts/database-types.mjs --check`.
  Expected: generated types expose the exact RPC signature and drift check passes.
- [ ] Commit the RPC, focused tests, generated types and migration-list update.

### Task 2: Observed decision contention and delivery verification

**Files:** Modify `tests/helpers/request-lock-cases.mjs` and
`scripts/verify-invitation-upgrade.mjs`. Create `docs/volo-193-verification.md`.

**Interfaces:** Consumes Task 1's exact RPC/results. Export
`verifyRequestDecisionLocks({sql,session,until})` from the existing lock-case module;
the existing upgrade verifier supplies these owned SQL/session/barrier functions.

- [ ] Extend the existing lock fixture module with cases for last place, same-request
  matching retry, accept-first/decline-second, decline-first/accept-second, and both
  acceptance/PRIVATE-removal orderings. Observe `pg_blocking_pids` before releasing
  the first transaction. Assert exact result codes and final rows/capacity, with fixture cleanup.
- [ ] Run these cases through the real authenticated RPC, replacing no assertions with
  privileged direct acceptance. Expected: one `decided` and one `capacity_full` for two
  requests competing for one place; matching retry `already_decided`; opposing decision
  `request_conflict`; either removal ordering ends cancelled and unselected.
- [ ] Wire the export into the existing upgrade CI path. Verify an additive upgrade
  from the immediately prior schema with existing fictional request/flight/member rows
  unchanged; reuse the owned upgrade fixture primitives without running unrelated invitation races.
- [ ] Run the focused pgTAP command from Task 1, decision lock cases, type drift check,
  TypeScript and focused ESLint/diff checks. Expected: all pass. Record exact checks,
  skipped full suite/hosted checks, observed overlap and cleanup in the verification document.
- [ ] Commit tests and evidence. Obtain an independent whole-branch review; fix any
  material findings with focused regression coverage. Stop only the resources created for this ticket.
- [ ] Push the branch, create the user-requested PR against `main`, attach it to this chat,
  and report its URL and verification limits. No merge or production publishing.
