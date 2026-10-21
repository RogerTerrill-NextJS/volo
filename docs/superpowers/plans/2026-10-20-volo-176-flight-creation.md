# VOLO-176 Guarded Flight Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Create upcoming flights through a guarded Server Action and a session-authenticated database function that independently enforces current eligibility and derives ownership.

**Architecture:** Preserve closed direct table writes. One narrow definer RPC owns atomic database eligibility/time checks and insertion; the application uses existing session clients, mutation guards and VOLO-175 validation. Reuse owned Auth/app fixtures for actual Server Action-to-database proof.

**Tech Stack:** PostgreSQL 17/Supabase, Next.js 16.3.8 Server Actions, TypeScript, pgTAP, existing Node test infrastructure.

**Spec:** [Approved creation design](../../volo-176-creation-design.md).

## Global Constraints

- Branch `feature/volo-176-flight-creation`; preserve unrelated AGENTS.md/docs/audits changes.
- No UI, recipient rows/selection, edit/cancel workflow, new database columns, dependencies or production deployment.
- NETWORK and PRIVATE remain explicit; a new PRIVATE flight without recipients is owner-only.
- Require current active membership and completed licensed profile, including admins; derive owner from auth.uid().
- Require a finite departure strictly after current database time immediately before insertion.
- Reuse bounded 16 KiB forms, origin/current-access/profile guards, no-store responses and session-scoped RPC access.
- Disable automatic write retries; uncertain outcomes never report success or silently issue another insert.

## Review Focus

- Membership revoked after the application's precheck: database denies creation under the retained session (Tasks 1/3).
- Departure becomes past after transaction start: final clock_timestamp check rejects it (Task 1).
- RPC called directly with owner/status/recipient arguments: no matching callable signature or table-write grant (Tasks 1/3).
- Commit succeeds but response is lost: one row exists and the action returns unconfirmed without retry (Task 3).
- Restrictive identity/profile foreign keys: owned fixture cleanup removes flights and profiles before common account cleanup (Task 3).

## Task 1: Atomic session-owned creation RPC

**Files:** Create `supabase/migrations/20261020030000_create_flight.sql`, `supabase/tests/database/flight_creation.test.sql`; modify `scripts/verify-invitation-upgrade.mjs`; regenerate `lib/supabase/database.types.ts`.

**Interfaces:**
- Consumes flights/memberships/profiles and their constraints, auth.uid(), current Supabase roles.
- Produces `public.create_flight(p_departure_airport text, p_destination_airport text, p_departure_at timestamptz, p_departure_timezone text, p_aircraft_description text, p_pilot_places integer, p_notes text, p_visibility public.flight_visibility) returns uuid`.
- Permission failures use SQLSTATE 42501 with generic text; non-finite/past departures use 22023. Existing structural check failures remain constraint failures. No private row/error content is returned.

- [x] Write/run a failing pgTAP function-existence assertion before creating the migration.
- [x] Add rolled-back owned fixtures for completed member/admin, active without profile, disabled and unadmitted callers. Assert valid creation returns one UUID, immutable authenticated owner, open status, derived local date and correct visibility. PRIVATE starts with no recipients and remains hidden from unrelated members.
- [x] Assert anonymous/missing-subject/disabled/no-profile denial, metadata spoofing denial, null/nonfinite/past departure rejection, bounded content constraints and continued direct-table insert denial. Reject alternate owner/status/recipient RPC arguments. Confirm rejected calls leave no new flights.
- [x] Add a bounded transaction-time regression: choose a departure after transaction_timestamp(), wait briefly until it is past wall-clock time, then assert RPC denial. This distinguishes clock_timestamp() from a stale transaction-start check.
- [x] Implement the fixed-search-path definer function, revoke unintended execute grants and grant authenticated execution only. Derive owner, lock/check membership then profile with shared row locks, enforce future departure immediately before INSERT, explicitly insert allowed content and return generated UUID. Preserve all existing RLS/grants.
- [x] Run new creation SQL plus existing flights/membership/profile SQL on an owned disposable database, including seed independence. Verify additive upgrade preserves existing fictional Auth/membership/profile data.
- [x] Append migration version 20261020030000 to both existing upgrade-verifier history checks. Generate types with the pinned local CLI and check drift; do not handwrite types or bypass the verifier's GitHub-only guard.

## Task 2: Shared future validation and guarded Server Action

**Files:** Modify `lib/flights/validation.ts`; create `lib/flights/mutation.ts`, `lib/flights/actions.ts`, `tests/flight-creation.unit.mts`; update the existing focused flight unit command in `package.json`.

**Interfaces:**
- `validateFlightForCreation(raw: unknown, now?: number): FlightValidation` composes validateFlight and a strict future-instant check. Ordinary validateFlight keeps its reusable calendar/content behavior.
- `flightCreatePolicy(): MutationPolicy<FlightValidation, FlightCreateResult>` sets requireCompleteProfile true and allows member/admin.
- `FlightCreateResult`: `{code:'created';flightId:string}` or safe invalid_input/forbidden/unavailable results; invalid_input can carry existing FlightField errors. Unavailable text instructs verification before retrying.
- `createFlight(previous:unknown, form:FormData)` calls handleActionMutation with the policy and 16384-byte limit, following profile action conventions.

- [x] Write failing unit cases for future/equal/past departures against an injected now. Preserve the existing timezone matrix instead of repeating it in transport tests. Invalid input must not echo submitted values.
- [x] Implement validateFlightForCreation using the normalized UTC value. Return a departure-local-time field error for non-future creation; preserve protected-field rejection.
- [x] Implement the server-only policy: wrap validation for guarded field feedback, use the existing complete-profile gate, map eight normalized fields explicitly into the session RPC, and use a five-second request/body deadline, cache:no-store, redirect:error and retry(false).
- [x] Map permission/validation failures to static results. Confirm success only for a valid returned UUID. Null/malformed responses, transport errors and uncertain commits return unavailable; no request body or raw database detail enters feedback.
- [x] Export only the async guarded Server Action. Add no production form, page, JSON route or secret-client shortcut.
- [x] Run the focused flight/profile validation tests and TypeScript check.

## Task 3: Real direct-create and failure regression

**Files:** Create `tests/helpers/flight-create-cases.mjs`; extend `tests/helpers/real-auth-app.mjs`, `tests/helpers/local-auth-stack.mjs`, `scripts/verify-auth-integration.mjs`; add `test:flights:create` command in `package.json`; create `docs/volo-176-verification.md`.

**Interfaces:**
- `verifyFlightCreation({stack,app,scenario})` adds cases to the existing owned Auth runner; it does not create another stack/app harness.
- Real-app fixture gains an opt-in flight form/action transport and fixture-only RPC response-loss control. Existing app.request/session/scenario reporting remain the transport/evidence boundary.
- Local stack helper gains narrowly owned profile-fixture cleanup using its existing requireOwned/ownedFixtureSql checks; no general SQL or hosted destination input is exposed.
- `--flight-create` runs only the creation scenarios using the existing setup/cleanup path. Normal Auth CI includes the same cases while reusing its existing compiled app.

- [x] Add actual native and fetched Server Action cases: completed member/admin creates exactly one owned flight; missing membership/profile, disabled callers and foreign/missing origins cause no insert; input overflow and protected fields cause no insert. Verify private cache headers and safe result content.
- [x] Exercise the session RPC directly with genuine local Auth JWTs to confirm current membership/profile checks and owner derivation independently of page/Server Action guards. Do not reuse privileged credentials for caller requests.
- [x] Discard a committed RPC response in fixture instrumentation, then assert one row exists, action reports unavailable and no second write occurs. Keep failure controls out of production modules.
- [x] Clear only flights/profile fixtures belonging to the case's tracked fictional subjects before common identity cleanup. Test the focused mode and ensure the normal runner's flight-visibility cases cannot observe leftover creation fixtures.
- [x] Run focused creation integration, new SQL and relevant flight/profile units. Run local-stack helper regression if its ownership/cleanup code changes, focused lint/type checks and generated-type drift checks. Full application/historical concurrency suites remain CI/release checks.
- [x] Obtain a whole-change review, resolve actionable findings and rerun affected checks. Record actual pass/fail/skipped results and any limits. No claim of hosted migration, preview verification or production release.

## Execution recommendation and self-review

Recommend native execution in this session because the RPC, generated types and
real Server Action fixture share one tightly coupled contract. One whole-change
independent review follows the focused checks.

Self-review: all approved write/auth/time/error requirements map to Tasks 1–3.
No new product choice, direct-write grant, idempotency column or unrelated lifecycle
operation is required. Membership/profile row locks and fixture cleanup are explicit.
