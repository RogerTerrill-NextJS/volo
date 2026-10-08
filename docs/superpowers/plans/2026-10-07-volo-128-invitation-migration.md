# VOLO-128 Invitation Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Preserve Roger’s native execution preference, with one fresh whole-branch review at the end.

**Goal:** Implement the approved invitation tables and snapshot integrity constraints, with proof of clean rebuild and upgrade from the existing membership schema.

**Architecture:** One new transactional migration creates invitations and send attempts with enums, checks, partial unique indexes and restrictive foreign keys. Enable RLS and deny client access in the same migration so there is no exposed intermediate deployment. The migration supplies persistence only; future trusted server interfaces enforce transitions and verified Auth evidence.

**Tech Stack:** PostgreSQL 17, pinned Supabase CLI 2.119.0, pgTAP, Node 24 and GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-07-volo-127-invitation-schema-design.md` — already approved in VOLO-127 and merged in PR22.

## Global Constraints

- Feature branch: `feature/volo-128-invitation-migration`, based on main merge `0c3dac0`.
- Application invitations never expire with age; provider links and setup authorizations remain finite.
- ASCII email normalization folds A-Z only, preserves dots/plus, rejects non-ASCII and untrimmed stored input, and limits stored addresses to 254 bytes. Server syntax validation remains downstream.
- No hosted migration/reset, accounts, mail, Auth settings or production publishing. Deploy Previews share production Supabase; no staging.
- No membership/admission trigger, role column, provider secrets, setup-authority implementation, business RPC, expiry job or Realtime publication.
- Never rewrite the existing membership migration. Immutable identity, increasing generations and verified transitions are trusted-interface responsibilities, not claims made by snapshot checks.
- VOLO-129 retains access-policy review/expanded tests; VOLO-130 retains comprehensive database/concurrency regressions. Include meaningful migration regression tests here.
- Regenerate types mechanically now to satisfy existing CI drift checks; VOLO-131 retains final generated-type/interface handoff. Never hand-edit generated output or weaken the drift gate.
- Docker is unavailable locally. Use disposable GitHub CI for database evidence; do not substitute static SQL inspection for runtime proof. Local ordinary checks remain required.

## Review Focus

1. NULL-valued SQL checks must not admit partial setup, terminal or reconciliation evidence.
2. Email case folding must be deterministic under non-default collations; dots/plus remain distinct and generated keys cannot be overridden.
3. Terminal invitations release live uniqueness without letting database acceptance imply permission to replace an existing Auth account or membership.
4. Existing active/disabled memberships and Auth references survive an upgrade unchanged; reference deletion is explicit and restrictive.
5. New tables deny browser access immediately, including admin browser sessions, even under permissive default privileges; setup UUIDs remain correlation only.

## Task 1: Migration with meaningful integrity and isolation tests

**Files:**
- Create `supabase/migrations/20261008010000_create_invitations.sql`.
- Create `supabase/tests/database/invitations.test.sql`.

**Interfaces:** Consumes auth.users and public.memberships unchanged. Produces public.invitations, public.invitation_send_attempts, invitation_status, invitation_send_kind, invitation_send_outcome and invitation_send_resolution exactly as named in the spec. Consumers must use trusted interfaces; no new executable business interface is introduced.

- [ ] Write rolled-back pgTAP fixtures with fictional Auth rows, active/disabled memberships and valid invitations/attempts; fixtures must work without seeds. Assert missing tables first (RED on the previous schema), then grow coverage with each constraint group.
- [ ] Run `npm run db:test` against a disposable prior-schema database; expect failure because invitation tables do not exist. If Docker remains unavailable locally, preserve a CI RED run before adding the migration; never claim an unobserved failure.
- [ ] Create the migration in one transaction. Copy every field/default/nullability and enum value from the spec. IDs default gen_random_uuid(); timestamps use timestamptz and now(). Use generated stored `translate(recipient_email COLLATE "C", 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')` for recipient_email_key, with deterministic C collation on the key. Require trimmed, nonempty ASCII input and <=254 bytes; no provider alias normalization.
- [ ] Add partial unique indexes for recipient_email_key and non-null auth_user_id across pending_issuance/issued/setup_verified/password_established. Unique attempt (invitation_id, invitation_version); never FK historical version to mutable current version. All Auth/invitation FKs ON DELETE RESTRICT; forbid self-supersession. setup_authorization_id remains nullable correlation UUID without fake authority FK.
- [ ] Implement explicit IS NULL/IS NOT NULL snapshot checks from the spec: positive version; timestamp ordering; complete verified subject/time/setup triples matching auth subject; password and redemption requirements; terminal metadata exclusive to its status. Revoked/superseded may retain complete prior evidence, including ordered password evidence; incomplete evidence always fails. Bound nonempty trimmed revocation reason to 500 characters.
- [ ] Define attempt outcomes: started requires no completed_at; accepted/rejected/unknown require completed_at >= started_at. Reconciliation fields are both absent or both present, only on original started/unknown outcomes, reconciled_at >= coalesce(completed_at, started_at). Limit provider_error_code to nullable safe categories `timeout`, `provider_rejected`, `rate_limited`, `provider_unavailable`, `identity_conflict`, `unknown`; raw errors are rejected. Codes do not themselves prove provider outcomes.
- [ ] Enable RLS, revoke ALL table privileges from PUBLIC/anon/authenticated, grant service_role SELECT/INSERT/UPDATE only; no client policies. Maintenance deletion remains owner-only. Revoke enum privileges from PUBLIC/anon/authenticated and grant USAGE to service_role. Document that service-role bypass is not caller authorization.
- [ ] Test valid snapshots for all seven invitation statuses; missing required nullable components, subject mismatch, reversed times, zero/negative versions, inappropriate terminal fields, self/missing references, invalid reconciliation pairs and raw error text fail with expected SQLSTATE. Verify old invitations still insert/update normally without age checks.
- [ ] Test case-equivalent live duplicate email and live subject fail (23505); dot/plus variants stay distinct; terminal history permits a new live record structurally. Generated key override fails. Non-ASCII, surrounding whitespace, empty/overlong email fail (23514). Null auth subjects remain permitted before issuance.
- [ ] Test one attempt per generation, historical attempts survive parent version advancement, and referenced Auth/parent rows cannot be deleted (23503). These snapshots do not prove concurrent server generation fencing or immutable identity; retain downstream gates.
- [ ] Test RLS flags and absence of client privileges for both tables; actual SELECT/INSERT/UPDATE/DELETE attempts as anon and authenticated fail (42501), including admin/disabled JWT subjects. Service role can perform required operations. Invitation insertion and verification leave existing memberships unchanged and create no new membership.
- [ ] Run `npm run db:reset`, `npm run db:test`, then `npx --no-install supabase db reset --local --no-seed` and `npm run db:test` on owned disposable CI/local databases. Expected: migration applies and all invitation plus existing membership assertions pass both times.
- [ ] Commit migration and tests; preserve RED/GREEN logs in ticket-specific ignored scratch.

## Task 2: Upgrade proof, generated types and reviewed PR

**Files:**
- Create `scripts/verify-invitation-upgrade.mjs`.
- Modify `.github/workflows/ci.yml` database job.
- Regenerate `lib/supabase/database.types.ts` with the pinned CLI.
- Modify `docs/supabase-setup.md` with actual evidence/scope.

**Interfaces:** Consumes Task 1 migration/tests. Produces repeatable prior-schema upgrade verification, current generated public-schema types and migration handoff evidence. No application callers are added.

- [ ] Implement a no-argument CI-only upgrade verifier. Reject arguments, require GitHub Actions disposable runner context, fixed project_id volo, and inspect the local database container’s Supabase project label before any write. Never accept connection URLs/project refs or inherited database credentials. Use pinned CLI and docker via child_process without shell interpolation.
- [ ] In the owned CI database, invoke `supabase db reset --local --version 20261006040000` with fictional seeds; snapshot ordered memberships and relevant Auth fixture fields through container-local psql with ON_ERROR_STOP. Assert baseline migration history and absence of invitation tables before upgrade. Reject unexpected container/schema rather than resetting an unrelated stack.
- [ ] Run `supabase db push --local --skip-vault --yes` to apply pending migrations, without reseeding or rewriting history. Compare exact baseline snapshots afterward; assert both migration versions recorded and invitation tables present. Run pgTAP on the upgraded schema. Expected: existing fixture rows/roles/disabled metadata unchanged and all tests pass.
- [ ] Add the upgrade check to the existing database CI job after clean/no-seed rebuild tests and before type generation. Give it a clear step name; preserve cleanup on failure. Run it against the new migration and require exit 0; capture baseline, upgrade and test results without secrets.
- [ ] Generate types using `npm run db:types`, then `npm run db:types:check`; expect exit 0. If local Docker is unavailable, obtain actual output from the disposable CI schema: ensure artifact generation still runs after a stale-type check failure, upload output, download the artifact for the exact reviewed head, verify artifact digest, commit bytes unchanged, then require a fresh green drift check. Never accept a stale-type failure as final success.
- [ ] Update database setup documentation with schema location, no-expiry behavior, initial fail-closed access, upgrade/rebuild commands and real CI evidence. Distinguish checked-in migration from hosted deployment. Preserve VOLO-129/130/131 responsibilities and all real-Auth downstream gates.
- [ ] Run ordinary tests with synthetic public configuration, typecheck, lint and git diff --check locally. Expected: all pass; log warnings separately. Database/real Auth CI and Deploy Preview must pass for final merge recommendation; investigate failures before claiming readiness.
- [ ] Commit tested changes and obtain one fresh whole-branch review using the native workflow. Include spec, plan, rulings and the five Review Focus items. Fix material findings in one verified pass; record deferred minors/rulings without a second review.
- [ ] Push only the feature branch, create/attach PR into main, and record evidence in VOLO-128. Keep ticket In Progress until user merge is verified. Never merge or publish production automatically.

## Plan self-review

The two tasks cover the schema deliverables and clean/upgrade proof. Initial fail-closed permissions prevent an unsafe gap before VOLO-129; mechanically generated types preserve CI without completing VOLO-131. Constraint tests cover valid/invalid NULL snapshots, normalization, uniqueness, restricted deletion and membership preservation. Transition/Auth guarantees remain explicitly outside this migration. The only extra concrete bounds are reason length and safe error categories; they are implementation choices for review in this plan, not a new activation policy.
