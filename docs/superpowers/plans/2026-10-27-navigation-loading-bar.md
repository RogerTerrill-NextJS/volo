# Navigation Loading Bar Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this approved work inline.

**Goal:** Show a thin top bar while an internal link navigation is pending.

**Architecture:** A shared Link wrapper uses supported Next.js useLinkStatus to render a portal indicator outside the link. A root document-navigation observer covers ordinary anchors without intercepting navigation. Reuse one visual component and preserve auth, prefetch and restoration behavior.

**Tech Stack:** Next.js 16.3.8, React 19.2.8, TypeScript, CSS; no dependencies.

**Spec:** docs/superpowers/specs/2026-10-27-navigation-loading-bar-design.md

## Global Constraints

No new protected loading boundary, router/history/fetch patches, backend changes or production publishing. Preserve prefetch flags and native anchor semantics. Respect reduced motion and screen-reader feedback.

## Review Focus

- Modifier/target/download/external/anchor clicks must remain unaffected.
- Query-only, successive and failed navigation must clean up correctly.
- Link feedback must not duplicate native anchor feedback.
- Document restoration must clear feedback without changing existing access rechecks.
- Indicators must not shift layout or imply measured progress.

### Task 1: Navigation feedback

Files: create lib/navigation-progress.ts, tests/navigation-progress.test.mts, app/_components/navigation-progress.tsx, app/_components/progress-link.tsx; modify app/layout.tsx, app/globals.css and existing next/link imports under app.

- [x] Add focused policy tests: internal click accepted; query navigation accepted; prevented/modifier/secondary/download/foreign-origin/target/anchor navigation ignored; same-address document reload accepted.
- [x] Run the focused test before implementation and observe failure.
- [x] Implement the pure native-click policy and shared indeterminate indicator. Native observer clears on pageshow/popstate/Escape and bounds feedback if unload is cancelled. Next pending state owns client-link completion and errors.
- [x] Replace application Link imports with shared wrapper, retaining props and all prefetch values; mount native observer in root layout. Add fixed top styles, no pointer interception, and static reduced-motion treatment.
- [x] Run policy tests, TypeScript and changed-file lint. Verify real Next navigation in a disposable local browser fixture, including slow success, query changes, errors, rapid clicks and native links; capture screenshot.
- [ ] Review the full diff, fix substantive findings, commit only this feature, push feature/navigation-loading-bar, create and attach PR. Production remains unchanged.
