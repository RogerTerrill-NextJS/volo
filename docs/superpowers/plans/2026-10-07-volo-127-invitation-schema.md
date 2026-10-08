# VOLO-127 Invitation Schema Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Preserve the user's selected native execution method.

**Goal:** Publish the approved invitation schema/interfaces and align their implementation tickets without implementing the migration.

**Architecture:** The approved spec defines the two-table persistence design. Existing database/activation documentation links to that contract; Jira describes each consumer's responsibility and verification gates.

**Tech Stack:** Markdown and Jira; the design targets the project's PostgreSQL 17 / Supabase baseline.

**Spec:** `docs/superpowers/specs/2026-10-07-volo-127-invitation-schema-design.md`

## Global Constraints

- Application invitations never expire with age. Provider tokens and setup authorizations remain finite.
- Specific-email invitations; ASCII-only MVP input with deterministic case folding, preserving dots and plus suffixes.
- Admin-only MVP issuers; member invitations remain future work. Recipient membership is member only.
- No migration, runtime Auth flow, hosted database/Auth settings, accounts, email or production publication in VOLO-127.
- Use feature/ branches, local/disposable write tests, and Deploy Previews plus production only. No staging; previews share production Supabase.
- No membership at issuance/verification; no downstream implementation ticket is completed by this documentation merge.

## Review Focus

Manual document checks must cover:

1. Old invitations remain eligible independently of provider/setup expiry.
2. Concurrent sends and late provider results cannot rebind identity, revive terminal rows or bypass generation fencing.
3. Snapshot constraints are distinguished from historical transition enforcement and verified Auth/session evidence.
4. Referenced Auth users and invitation audit records are not silently cascade-deleted; future erasure work is explicit.
5. Setup correlation identifiers are not bearer authority, and an existing/disabled membership is never overwritten on redemption.

Runtime tests for these policies remain with VOLO-128/129/130/29/30/122/124/125.

## Task 1: Publish the database contract in existing documentation

**Files:** Modify `docs/supabase-setup.md` and `docs/superpowers/specs/2026-10-07-volo-121-invitation-contract-design.md`; read the approved VOLO-127 spec.

**Interfaces:** Consumes the approved schema spec. Produces durable links and clear ownership; no new runtime API or SQL.

- [ ] Read the database setup guide and existing activation contract before editing.
- [ ] Add a concise schema handoff to `docs/supabase-setup.md`: invitations/send attempts, no invitation expiry, trusted-server-only access, no migration applied yet, and VOLO-128/129/130/131 implementation ownership.
- [ ] Link the approved schema from VOLO-121's identity/record section; preserve the approved activation behavior and identify separate setup-authority storage under VOLO-122.
- [ ] Check all five Review Focus items against the linked specs. Correct material contradictions without expanding into downstream runtime implementation.
- [ ] Verify every local link in changed Markdown resolves. Run `git diff --check`; expected exit 0. No new automated tests for documentation-only changes.
- [ ] Commit the documentation handoff on `feature/volo-127-invitation-schema`.

## Task 2: Align downstream Jira interfaces and prepare the PR

**External artifacts:** VOLO-127/128/129/130/131 plus VOLO-29/30/122/124.

**Interfaces:** Consumes the committed schema contract and existing descriptions. Produces preserved, aligned acceptance criteria and a reviewed documentation PR.

- [ ] Read each affected Jira description before editing; preserve unrelated requirements.
- [ ] Link the schema on VOLO-128/129/130/131 with two-table/constraint/access/type generation responsibilities, PostgreSQL 17, no application expiry, and explicit no-runtime-claim gates.
- [ ] Add consumer handoffs to VOLO-29/30/122/124: operation/version fencing, unknown-result reconciliation, atomic member/redemption, separate verified setup authority and password-step evidence. Preserve prior activation and authorization requirements.
- [ ] Record the reviewed schema/link and implementation sequence on VOLO-127. Read back all affected descriptions; normalize paragraph formatting only when comparing saved content.
- [ ] Run the ordinary suite using existing synthetic public configuration; expect all tests passing. Record warnings separately from failures. Recheck links and whitespace.
- [ ] Obtain one fresh whole-branch document review using the native workflow. Address material findings in one fix pass; do not dispatch a second review. Record rulings/deferred minors.
- [ ] Push only the feature branch and create/attach a documentation PR into main, summarizing manual checks, ordinary tests and downstream implementation scope. Do not merge or publish production.
- [ ] Verify the created PR's state and report CI/preview status accurately. Keep VOLO-127 In Progress until user merge and verified main ancestry.

## Plan self-review

The approved spec supplies all VOLO-127 design deliverables; these tasks publish the contract and align its consumers. They intentionally do not implement VOLO-128's migration, VOLO-129's permissions, VOLO-130's database tests or VOLO-131's generated types. Manual consistency/link checks plus the existing ordinary suite are proportionate to the documentation change.
