# VOLO-179 private recipients implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. Track steps below.

**Goal:** Atomic PRIVATE selection and owner-guarded recipient changes.
**Architecture:** Reuse creation/access/directory boundaries; narrow session RPCs and
existing RLS; fail closed on removals when future lifecycle tables appear.
**Tech Stack:** Installed Next.js/Supabase/TypeScript/PostgreSQL/pgTAP; no dependencies.
**Spec:** [Approved design](../../volo-179-recipient-design.md).

## Task 1 — Database boundaries

- [x] Observe missing-recipient-RPC SQL failure on owned baseline stack.
- [x] Add 20261021010000_private_recipients.sql with atomic create_private_flight,
  private ID validator, and change_flight_recipient; authenticated-only execute,
  fixed search paths, membership/flight locks and removal safeguard.
- [x] Add focused SQL eligibility, identity, all-or-nothing creation, RLS revocation,
  idempotence, closed direct writes and future-table safeguard cases.
- [x] Verify additive preservation, relevant SQL regressions and concurrency locally;
  generate actual database types/check drift, update upgrade migration allowlists.

## Task 2 — Application boundaries

- [x] Write failing selection/parser/candidate behavior tests, then implement
  lib/flights/recipients.ts and recipient-query.ts with existing directory ports.
- [x] Compose existing flight validation with optional recipient_ids; use atomic
  private RPC only for nonempty selections. Keep existing callers compatible.
- [x] Add recipient-mutation.ts, share bounded session client, export fixed add/remove
  Server Actions using existing guards and server-loaded ownership. Map static results.
- [x] Make creation confirmation reflect confirmed selected-recipient count.
- [x] Run focused unit/type/lint checks. No picker UI or new production routes.

## Task 3 — Real integration and review

- [x] Extend existing owned Auth/compiled action fixture for recipient operations and
  candidate query; cover owner/foreign/admin/origin/current membership, atomic invalid
  batch, selected versus unrelated visibility, remove/re-add, no leaked credentials.
- [x] Run focused integration and affected checks; clean owned fixtures/stacks.
- [x] Obtain one independent whole-change review and address actionable findings.
- [x] Record modified files, actual results, lifecycle safeguard limits and preview
  handoff; commit/push only ticket files and create/attach requested PR.
