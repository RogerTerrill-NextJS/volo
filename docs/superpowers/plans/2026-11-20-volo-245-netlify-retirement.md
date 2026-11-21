# VOLO-245 Netlify Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire only the old `voloapp` Netlify project while keeping Vercel production, automatic PR previews and rollback recovery intact.

**Architecture:** Audit and prepare first. Replace the project-specific required preview check before stopping Netlify builds, then use reversible project disablement only after the migration and retention gates are satisfied. Keep a record of every external setting changed.

**Tech Stack:** GitHub classic branch protection, Netlify project settings, Vercel deployment/environment settings, existing Supabase backend, Markdown operational records.

**Spec:** [Retirement scope](../specs/2026-11-20-volo-245-netlify-retirement-design.md), based on VOLO-245.

## Global constraints

- Old project: `voloapp`, Roger Terrill's team; `volo-uy2m` is outside scope.
- Current production: `https://volo-six-woad.vercel.app`; no database migration.
- Automatic Vercel PR previews and manual production promotion remain required.
- Preserve Netlify production auto-publishing lock until retirement.
- No permanent project deletion, shared-app uninstall or shared-key rotation.
- Hold retirement until VOLO-244 verification and the agreed retention checkpoint.

## Review focus

- A future PR must not wait forever for a stopped Netlify preview check.
- The replacement must preserve a successful Vercel preview requirement and all existing PR protections.
- Old Netlify links and installed PWAs must not be assumed to change origin.
- Removing a Preview variable must not remove the Production secret or be mistaken for revoking retained deployments.
- Re-enabling Netlify does not restore Supabase Auth settings or database state.

## Task 1: Inventory and record preparation

**Files:** Create `docs/netlify-retirement.md`; update `docs/release-workflow.md` and `docs/vercel-deployment.md`.

- [x] Inspect main's classic protection rule and current PR status names.
- [x] Confirm the reviewed release PR has successful `Vercel` and `netlify/voloapp/deploy-preview` statuses.
- [x] Verify public health endpoints on Vercel and retained Netlify return 200.
- [x] Inspect Preview/Production secret names and scopes without revealing values.
- [ ] Inspect authenticated Netlify configuration, published artifact, lock and account ownership after sign-in.
- [ ] Record the user's retention decision and old-link/PWA usage.
- [x] Update runbooks to identify Vercel as current production and Netlify as retained rollback.

Verification: read-only UI/API evidence recorded in the runbook; `git diff --check` exits 0. No application tests are needed for documentation-only changes.

## Task 2: Prepare the reviewed replacement

- [ ] Review the documentation diff and open its PR to verify automatic Vercel previews on a fresh branch.
- [x] Confirm exact `Vercel` success context and its trusted publisher in the branch-rule picker; discard the audit selection without saving.
- [ ] Record the before/after required checks: retain `Typecheck, lint, build and test`; replace only `netlify/voloapp/deploy-preview` with `Vercel`.
- [ ] Preserve PR requirement, up-to-date branch requirement, conversation resolution, admin enforcement and force-push/deletion restrictions.

Verification: the new PR receives a successful Vercel deployment; no protection change has been applied merely by drafting it.

## Task 3: Perform scoped cleanup and retirement

- [ ] Resolve VOLO-244 gates and reach the agreed retention checkpoint before stopping builds or taking Netlify offline.
- [ ] Apply and verify the reviewed required-check replacement before stopping Netlify.
- [ ] Confirm permanent removal of only the branch-scoped Preview secret override at action time; preserve the Production entry and shared Supabase key.
- [ ] Record separate disposition of retained privileged Preview artifacts; no deletion without confirmation.
- [ ] Stop builds for only `voloapp`; record effects on project-specific checks/integrations without uninstalling a shared GitHub App.
- [ ] Use **Disable project**, verify disabled state, and preserve **Enable project** recovery instructions.

Verification: before/after UI evidence, correct project/account, Vercel still healthy, required Vercel preview status intact, production auto-assignment still disabled. Existing Netlify links becoming unavailable is an explicit retirement effect.

## Task 4: Closeout

- [ ] Record final deployment/configuration pointers, production smoke and known limitations in VOLO-245.
- [ ] Record how to re-enable Netlify and restore approved Auth/domain settings without changing the database.
- [ ] Confirm remaining checks/integrations are intentionally retained or retired, and only then mark the ticket Done.

No full application suite rerun is planned for documentation or retirement settings alone. Any application change gets relevant targeted verification; any new release follows the full release checklist.
