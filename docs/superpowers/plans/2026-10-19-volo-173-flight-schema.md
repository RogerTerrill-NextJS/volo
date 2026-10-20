# VOLO-173 Flight Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add flight and recipient persistence with integrity constraints, initial visibility policies and generated types.

**Architecture:** One additive PostgreSQL migration creates both tables and their initial RLS/grants. Non-exposed private helpers avoid recursive RLS; member writes remain disabled until guarded mutation tickets. Reuse the existing local Supabase/pgTAP and upgrade verification tools.

**Tech Stack:** Supabase PostgreSQL 17, pgTAP, pinned Supabase CLI, TypeScript.

**Spec:** [Approved schema design](../../volo-173-schema-design.md), with [VOLO-172 visibility contract](../../volo-172-visibility-contract.md).

## Global Constraints

- Work on `feature/volo-173-flight-schema`; preserve unrelated AGENTS.md and docs/audits changes.
- Aircraft description: required nonblank trimmed text, at most 500 characters. Optional notes: at most 2,000 characters.
- Positive integer joining-pilot capacity, excluding owner; no mutable remaining count.
- Required explicit NETWORK/PRIVATE visibility; open/cancelled/completed status, initially open.
- UTC instant plus validated IANA zone and database-derived local date; same-airport flights allowed.
- Immutable membership-backed owner and restrictive foreign-key deletion behavior.
- Direct member writes disabled. No UI, posting RPC, future lifecycle tables, new dependencies or hosted changes.
- Generate types by actual CLI introspection, never by hand.

## Review Focus

- A timezone changes the calendar date across UTC midnight: database-derived date must remain consistent (Task 1).
- Valid summer/winter instants around DST changes: derive correct local date without interpreting ambiguous wall-clock input (Task 1).
- Disabled membership with unchanged JWT and recipient row: access must disappear immediately (Task 1).
- Selected recipient joins/counts against audience: expose only their own eligibility, without recursive RLS (Task 1).
- Privileged data writes: ownership immutability, timezone validation and recipient structural constraints still apply (Task 1).

## Task 1: Flight migration and security behavior

**Files:**
- Create `supabase/migrations/20261020020000_create_flights.sql`.
- Create `supabase/tests/database/flights.test.sql`.

**Interfaces:**
- Consumes existing `memberships(user_id, status)`, `auth.uid()` and Supabase roles.
- Produces `public.flights`, `public.flight_recipients`, `public.flight_visibility` and `public.flight_status` as specified in the design.
- Private helpers live in `flight_private`, outside exposed schemas, with empty search paths, explicit grants and no supplied viewer identity.

- [x] Write a failing pgTAP schema assertion for the absent tables and run it against an owned local database. Then extend the same rolled-back fixture file for the behaviors below before implementing them.
- [x] Assert required fields, the 500/2,000 character boundaries, positive integer capacity, uppercase 2–8 character airport format, and successful same-airport insertion. Reject unsupported visibility/status values.
- [x] Assert valid named IANA zones and UTC; reject abbreviations, arbitrary offsets, invalid zones and infinite instants. Test UTC-midnight date shifts, DST-season instants and recomputation on departure/zone updates. A supplied local date cannot override the derived value.
- [x] Assert immutable owner, restrictive identity/flight deletion, recipient uniqueness, no owner-as-recipient, active selected membership and PRIVATE-only selection. Use real privileged inserts/updates rather than mocking constraints.
- [x] Assert anonymous denial, active member NETWORK access, owner/selected PRIVATE access and unrelated member/admin PRIVATE denial. Assert owner audience access versus recipient-own-row access, hidden counts/joins, spoofed claims and loss of access after disabling membership with the same JWT.
- [x] Assert authenticated insert/update/delete denial for both tables, including ownership spoofing, recipient self-addition and direct visibility edits.
- [x] Implement enums, tables, restrictive FKs, constraints, database-derived local date and timestamp/immutable-owner triggers. Retain validated recipient relationships without adding lifecycle operations.
- [x] Add indexes for stable departure/id ordering, owner lookup, visibility/upcoming queries and reverse recipient lookup. Avoid duplicate primary-key indexes.
- [x] Enable RLS and explicit grants in the creating migration. Add a narrow current-viewer PRIVATE-eligibility helper to avoid recursion; use current membership for all ordinary reads. Do not grant anonymous access or member writes.
- [x] Run the focused file with `supabase test db supabase/tests/database/flights.test.sql --local`; all assertions must pass. Also run membership tests because the new policies depend on that boundary. Repeat focused tests after a seedless disposable rebuild.

## Task 2: Upgrade, generated types and handoff

**Files:**
- Modify `scripts/verify-invitation-upgrade.mjs`: append `20261020020000` to both migration-history checks.
- Regenerate `lib/supabase/database.types.ts` with `scripts/database-types.mjs`.
- Create `docs/volo-173-verification.md` with actual results and remaining review limits.

**Interfaces:**
- Consumes the Task 1 migration/tables and existing pinned CLI/type generation script.
- Produces introspected public-schema types and upgrade verification compatible with the new migration.

- [x] Update the existing verifier's allowed/expected migration versions without weakening its ownership or fixture-preservation assertions. Its GitHub-hosted-only execution guard remains intact.
- [x] On an owned local/disposable stack, apply the migration to the previous schema and compare pre/post fictional Auth, membership and profile snapshots. Reuse local tools; do not modify/reset an unowned developer stack. Record CI-only checks as pending rather than bypassing their guards.
- [x] Run `node scripts/database-types.mjs`, then `node scripts/database-types.mjs --check`; verify the generated diff adds only expected schema objects.
- [x] Run the repository TypeScript check and focused SQL tests. Do not run unrelated application/full-suite tests for this additive schema change. CI keeps its existing broader checks.
- [x] Review grants/helper execution, row isolation and trigger behavior against the approved design; resolve actionable findings and repeat only affected checks.
- [x] Record changed files, passed/failed/skipped checks and local-only scope. Mark VOLO-174 read-policy refinement and future guarded mutations as handoff work. No claim of hosted migration or deployment.

## Execution recommendation

Use native execution in this session: the migration, SQL fixtures and generated
types are tightly coupled, so one implementer can keep the database contract
consistent. Perform a whole-change review after focused verification.

Plan self-review: all approved schema/access requirements map to Task 1; types,
upgrade compatibility and evidence map to Task 2. No new product decisions or
application mutation interfaces are introduced by this plan.
