# VOLO Vercel Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare and verify Vercel previews for VOLO, with reviewed manual production promotion and the existing Supabase backend.

**Architecture:** Extend the existing build-pinned canonical origin resolver and shared private cache policy. Keep Netlify compatibility until cutover; use native Next.js deployment with no adapter or static export. Use Vercel project release controls rather than another deployment environment.

**Tech Stack:** Next.js 16.3.8, React 19.2.8, Node.js 24, Supabase, Vercel.

**Spec:** [Approved migration design](../specs/2026-11-19-volo-244-vercel-migration-design.md).

## Global Constraints

- Existing Supabase project; no hosting-driven database migration or reset.
- Automatic PR previews and manual production promotion; no production cutover without a user-requested release.
- Exact build-pinned trusted origin; never trust request headers or wildcard domains.
- Preserve Netlify production lock, rollback deployment and unrelated checkout edits.
- No secret values in source, ticket descriptions, command output or logs.
- Work on `feature/volo-244-vercel-migration` based on merged main `3e2a480`.

## Review Focus

- Missing or ambiguous provider metadata must fail closed rather than accept a local fallback.
- Preview aliases must not show usable forms with an origin that the mutation guard will reject.
- Production origin must be explicit and stable across immutable deployments.
- Provider-targeted cache policy must overwrite previously public cache headers.
- Vercel may consume targeted headers; hosted evidence must use the provider's documented cache status.

## Task 1: Inspect destination and release controls

Files: spec and `docs/vercel-deployment.md` (new).

- [x] Confirm user-selected existing `VOLO / volo`, no current deployments, no project variables, exposed system metadata.
- [x] Inspect repository connection, production branch, runtime and release-control settings.
- [x] Disable automatic production domain assignment while preserving automatic previews; verify saved state before any deployment.
- [ ] Record canonical project/preview URLs and secret variable names/scopes without values.

## Task 2: Vercel origin resolution and alias behavior

Files: `lib/auth/mutation-origin.mjs`, `tests/mutation-origin.test.mjs`, `next.config.ts`, and focused fixture tests if alias routing is required.

Interface: `resolveMutationOrigin(env: Record<string,string|undefined>): string`, existing sanitized failure and local behavior retained. Vercel Preview uses a single exact verified HTTPS deployment origin; Production requires explicit `VOLO_MUTATION_ORIGIN`. Canonical alias handling must preserve the same guard rather than add wildcard origins.

- [x] Add behavior tests for preview/production resolution, overridden local configuration, malformed metadata, ambiguous providers and unsupported environment.
- [x] Run `node --test tests/mutation-origin.test.mjs` and observe new cases fail.
- [x] Implement the resolver with Vercel provider detection and strict metadata validation; keep Netlify tests green.
- [ ] Add canonical alias routing only after inspecting actual generated URL behavior; cover alias forms and callback-token handling in a focused HTTP fixture.
- [ ] Run origin, mutation HTTP/Server Action and affected auth tests; commit only ticket files.

## Task 3: Private caching and hosting documentation

Files: `lib/http/private-response.ts`, `tests/private-response.unit.mts`, `next.config.ts`, relevant `scripts/verify-*.mjs`, `docs/private-caching.md`, `docs/environment-configuration.md`, `docs/auth-callbacks.md`, `docs/preview-verification.md`, `docs/release-workflow.md`, `docs/vercel-deployment.md`.

Interface: `applyPrivateResponseHeaders(headers: Headers): void` also replaces `Vercel-CDN-Cache-Control` with `no-store` while preserving response metadata and all existing policies.

- [x] Add conflicting Vercel cache policy to the existing behavioral replacement test; observe failure.
- [x] Add targeted no-store policy to shared responses and `/sw.js`.
- [ ] Verify local private/cache/Proxy responses and adjust hosted observation reporting for documented Vercel header consumption and `x-vercel-cache` evidence. Do not weaken the existing Netlify evidence gate.
- [x] Document exact preview origin/callback procedure, secret inventory, manual promotion, first-release Netlify rollback and hostname/session impact.
- [x] Run typecheck, lint, production build and relevant security regressions; record results (commit follows).

## Task 4: Preview, review and release handoff

Files: `docs/volo-244-verification.md` (new), ticket progress comments.

- [ ] Push the isolated feature branch, obtain Vercel preview and record exact SHA/URLs.
- [ ] Verify anonymous routing, health, SW/cache behavior, approved signed-in reads, member names/certificates/ratings, profile photos, directory, flights and messages. Use disposable local tests for mutations.
- [x] Run one fresh-context whole-change review under the requesting-code-review skill; resolve material findings with targeted tests.
- [ ] Prepare a reviewable PR when authorized, without merge or production publication.
- [ ] Report any hosted Auth/secret/configuration or account-access blockers concretely.
- [ ] Run the full release suite and production cutover only within the later requested release; preserve Netlify until VOLO-245's retention checkpoint.

## Execution ledger

- Design approved by user; destination is existing `VOLO / volo` (`volo7/volo`).
- Native implementation selected under the task's autonomous execution instructions; no extra plan-approval round is needed after explicit design approval.
- Existing feature branch and checkout retained; unrelated edits are preserved and excluded from ticket commits.

- Canonical preview choice: exact `VERCEL_URL`, with only the build-provided
  branch alias redirecting page navigation. Actual callback handlers have their
  own gate because Proxy deliberately excludes them. Real HTTP checks passed.
- Ruling: Harden the existing five-second Auth deadline as part of migration
  verification — unchanged main reproduced a stalled-body timeout, blocking
  critical workflow checks — an incorrect change could return transient Auth
  failures or leak async work, so deterministic abort tests and full Proxy
  regressions were required and passed.
- Account approval-review limit was transient; subsequent commands used normal
  review successfully. Source secrets were not recovered by bypassing Netlify's
  write-only protection; Production key entry remains with the user.

- Final local gate: typecheck/lint/build, 85 production smoke tests, 31 access
  unit plus HTTP checks, 10 Proxy unit plus HTTP checks, canonical HTTP probes,
  12 origin/alias/header tests and 40 callback/input tests passed. Full release
  suite (including real Auth/database jobs) remains a pre-cutover requirement.

- Implementation committed/pushed as `e79cdf9`. Explicit Vercel Preview is Ready
  at `volo-cl8q277y5-volo7.vercel.app`; platform protection retained. Root/login,
  health, exact branch-to-deployment routing and invalid alias callback rejection
  verified in browser. Initial automatic Git build unexpectedly targeted
  Production and failed closed; next documentation push will test classification.
- User handoffs pending: administrator sign-in to exact Preview, private entry of
  original Production-only Supabase secret, and production hostname choice.

- Production origin selected/configured as `https://volo-six-woad.vercel.app`.
  Secret type/Production scope confirmed without revealing the value.
- User approved/provisioned a Preview-only override on this reviewed branch for
  invitation administration. After identity verification, redeploy `6Xiw8cery`
  (source `6064f2e`) was Ready and authenticated invitation-list/form reads passed.
  No email, message, profile, flight, moderation or database mutation submitted.
- Authenticated browser reads passed for Members/profile/photo/directory,
  flights/creation form, messaging empty state, moderation/reports/metrics and
  Invitations. Mobile viewport override had no effect and was reset; no mobile
  pass claimed. Production release/full release suite remain separate.

- User explicitly requested PR creation after Preview/configuration verification.
  Main merge, production publication and Netlify archival remain unauthorized
  by this PR-creation request and are not performed.
