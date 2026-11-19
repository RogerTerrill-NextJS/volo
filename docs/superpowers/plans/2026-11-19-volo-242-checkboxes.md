# VOLO-242 Checkboxes Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan in this session.

**Goal:** Save and display multiple certificate/rating checkbox selections throughout VOLO without losing legacy data.
**Architecture:** Shared form option definitions and explicit repeated-field parsing; retain bounded text[] storage and existing profile readers/search RPCs.
**Tech Stack:** Next.js 16.3.8, React 19, TypeScript, Supabase Postgres, Node tests.
**Spec:** docs/superpowers/specs/2026-11-19-volo-242-checkboxes-design.md

## Global Constraints
- Use the exact option copy in VOLO-242; retain optional selections.
- Preserve unrelated workspace changes; use feature/ branches.
- Preserve owner authorization, mutation input size bounds, and duplicate rejection for scalar fields.
- No production publish; report preview/database verification limits explicitly.

## Review Focus
- Repeated selections must survive server saving, browser validation, and failed action feedback.
- Omitted groups must clear both arrays.
- Known aliases must select canonical choices; unknown legacy values must remain visible and removable.
- Invalid scalar duplicates, uploads, oversized data and foreign-owner fields must remain rejected.
- Full descriptive labels and codes must remain searchable and readable throughout shared profile consumers.

### Task 1: Checkbox selections and bounded saving
**Files:** lib/profiles/mutation.ts; lib/profiles/credentials.ts (options and alias mapping); lib/profiles/form-state.ts (repeated input and failure feedback); lib/auth/mutation-input.ts and action-mutation.ts (explicit opt-in repeated text fields); lib/profiles/actions.ts; app/(protected)/_components/profile-form.tsx; app/(protected)/profile/edit/actions.ts; tests/profile-edit.test.mjs; tests/profile-onboarding.test.mjs; tests/mutation-policy.unit.mts; tests/profile-credentials.unit.mts.
**Interfaces:** credentialOptions(field, selectedArray) returns canonical and retained legacy labels; profileFormInput(form) returns validator-ready record; profileInput(raw) decodes JSON checkbox labels under certificates[]/ratings[]; readMutationForm accepts an optional repeatable field allowlist, preserving its existing string record API and byte budget.
- [x] Add regression tests for native repeated checkbox submission, unchecked groups, legacy aliases, feedback recovery, and explicit opt-in repeated input bounds.
- [x] Run changed tests and observe failures caused by missing checkbox behavior.
- [x] Implement centralized labels, canonical alias selection and bounded repeated values; render labeled fieldsets; use shared form extraction on client/saved state and opt in server profile actions only.
- [x] Run focused profile/mutation tests; expect all passing.

### Task 2: App and database verification
**Files:** docs/volo-242-verification.md; existing directory/network/profile and downstream unit tests as needed.
**Interfaces:** Existing text[] profile storage, directory RPC substring filters, and shared PilotDetails.
- [x] Run directory/network/profile and downstream reader regression tests, type checking and changed-code lint.
- [x] Check local DB availability and run focused profile/directory SQL tests when available. Confirm no schema/types/RLS migration is required.
- [x] Review whole diff independently, fix material findings and rerun affected checks.
- [x] Record passes/failures/skips and database/preview/production verification separately.

Execution note: SQL execution was assessed and deferred because no local database container is running; Deploy Preview and production were not verified. See docs/volo-242-verification.md. Independent review required preserving embedded CR/LF inside legacy array elements; the regression and encoded checkbox transport are included.
