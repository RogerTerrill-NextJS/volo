# Atomic Invitation Redemption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Preserve the user's native execution preference; one independent final reviewer.

**Goal:** Create member membership and record invitation redemption in one restricted transaction.

**Architecture:** Extend existing invitation persistence with one service-only RPC. Reuse session-bound setup authority and existing password evidence; retain original setup context for no-write completed retries until its existing expiry. Existing cleanup and membership guards remain authoritative.

**Tech Stack:** PostgreSQL 17, Supabase CLI 2.119.0, pgTAP, generated TypeScript types, existing disposable GitHub CI.

**Spec:** `docs/superpowers/specs/2026-10-09-volo-152-atomic-invitation-redemption-design.md`

## Global Constraints

- Invitation age never expires eligibility; setup authority keeps its original 30-minute expiry.
- Membership is explicitly active/member; never upsert, overwrite, promote or re-enable membership.
- No Auth network operations, password handler, application route or new secret store.
- Use the current checkout on a `feature/` branch; preserve unrelated audit files.
- No staging environment; hosted Supabase/Auth/email changes and production publication require separate approval.
- VOLO-153 owns broader concurrency proof and the typed server adapter. VOLO-124 owns password evidence and completion orchestration.

## Review Focus

- SQL null inputs must fail closed rather than bypass a predicate.
- A correct correlation UUID with the wrong digest/session/origin must not redeem.
- A failure after membership insertion must leave both records unchanged.
- A completed retry after membership disabling must not re-enable access.
- Expiry cleanup after redemption must preserve terminal evidence.

---

### Task 1: Restricted atomic redemption and focused database proof

**Files:**
- Create: `supabase/migrations/20261009040000_invitation_redemption.sql` — one transaction function and explicit execution grants.
- Create: `supabase/tests/database/invitation_redemption.test.sql` — transactional fictional fixtures and focused assertions.
- Modify: `scripts/verify-invitation-upgrade.mjs` — add only migration `20261009040000` to both explicit history lists.
- Generate: `lib/supabase/database.types.ts` — exact pinned CLI output.

**Interfaces:**
- Consumes: `public.invitations`, `public.memberships`, `public.invitation_setup_authorizations`, `auth.users`, `auth.sessions`, and existing cleanup.
- Produces: `public.redeem_invitation(p_invitation_id uuid, p_expected_version bigint, p_setup_authorization_id uuid, p_setup_digest text, p_subject uuid, p_email text, p_session_id uuid, p_origin text) returns jsonb`.
- JSON is only `{code: redeemed|already_redeemed|conflict|denied}`; unexpected SQL errors propagate. Service-role execution only. Null/malformed authority yields denied; missing/stale invitation or incompatible live state yields conflict; wrong identity/authority/evidence or existing membership yields denied. Identical completed context yields already_redeemed without writes.

- [ ] **Step 1: Add failing pgTAP assertions.** Use `no_plan()` and transaction rollback as existing tests do. Create fixture users/session/invitation/setup using the real setup RPC and an accepted initial send fixture. Set password evidence through owner-only fixture SQL, never a fake production helper. Assert function existence, browser-role denial, and service execution privilege. Exercise every null argument, wrong digest/session/origin/subject/email/version, absent password evidence, expired authority/session, banned/anonymous/unconfirmed user, revoked/superseded invitation and existing active/disabled membership. Each rejected call leaves both tables unchanged.

  Pin successful and retry results using the same fixed fixture arguments:

  ```sql
  select is(pg_temp.redeem_fixture()->>'code','redeemed','eligible completion commits');
  select is((select count(*) from public.memberships where user_id=pg_temp.recipient()),1::bigint,'exactly one member');
  select is(pg_temp.redeem_fixture()->>'code','already_redeemed','identical retry does not mutate');
  ```

  Assert explicit member/active fields and an ordered redeemed timestamp. Use an old invitation creation date to pin no age expiry. Compare complete fixture rows before/after retries, including a retry after disabling membership. Add a temporary invitation-update failure trigger; the failing redemption must roll back its preceding membership insert. Remove the trigger before the success case. Expire retained setup context and call existing cleanup: authority disappears and redeemed evidence remains; expired retries are denied.

- [ ] **Step 2: Run the new assertions against the pre-function schema.** On an owned local/disposable stack run `npm run db:test`; expect missing-function assertions/errors. If Docker is unavailable locally, use the existing draft-PR disposable database job and retain the immutable failing run as evidence. No hosted database substitution or new CI harness.

- [ ] **Step 3: Implement the RPC migration.** Validate inputs, lock invitation first then matching setup row, and check current subject/email/session/origin/version/expiry and password snapshot. Check Auth user/session as specified. Handle authorized already-redeemed context before first-redemption membership rejection; never equate it to current app access. Insert member/active membership and update redemption in the same PL/pgSQL exception scope. A caught unique violation returns denied with that scope rolled back. Other failures propagate. Retain original setup row/expiry for existing cleanup; do not change its setup-reader semantics. Fully qualify references, empty search path, explicit revoke/grant, no caller-supplied roles or password-success flags.

- [ ] **Step 4: Verify the migrated database and upgrade.** Add the new migration to both upgrade-verifier history lists. Run `npm run db:reset`, `npm run db:test`; repeat tests after `supabase db reset --local --no-seed`. Run the existing upgrade verifier only on its owned GitHub runner. Expect all pgTAP assertions and unchanged prior Auth/membership snapshots. Existing renewal/setup/cleanup regressions must pass. Broader new overlapping redemption scenarios remain VOLO-153.

- [ ] **Step 5: Generate exact types and verify the branch.** Run `npm run db:types` then `npm run db:types:check` on the owned stack, or recover the existing CI-generated artifact and rerun CI's exact check. Never invent generated output. Run typecheck/lint and normal CI regression gates; expect all final-head jobs successful. Document any local tooling limitation using CI evidence rather than claiming a local pass.

- [ ] **Step 6: Review and hand off.** Obtain one independent final review of the migration, tests and five review-focus conditions. Resolve blockers, record deferred minor findings, and summarize the RPC contract and VOLO-153 boundary. Commit the product changes; PR creation/publication follows the user's authorization. Do not mark VOLO-30 complete before VOLO-153.

## Execution decision

Native execution in this session is recommended and preserves the established preference: this is one tightly coupled SQL deliverable, so multiple implementers would add coordination without separating useful work. Keep one independent final reviewer. No implementation begins until the user reviews this plan.
