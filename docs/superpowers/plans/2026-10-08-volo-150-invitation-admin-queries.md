# Invitation Admin Queries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give active admins a private read-only invitation list with accurate lifecycle and current-send labels.

**Architecture:** Add a small server-only query/DTO boundary over existing tables and access checks, then a dynamic page using the existing shell. Reuse the existing bounded Supabase client and compiled app/real Auth fixtures. No migration or provider send change.

**Tech Stack:** Installed Next.js 16.3.8, TypeScript, Supabase JS 2.117.2, node:test; existing CI.

**Spec:** `docs/superpowers/specs/2026-10-08-volo-150-invitation-admin-queries-design.md` (approved).

## Global Constraints

- Work inline on `feature/volo-150-invitation-admin-queries` from merged main; preserve untracked `docs/audits/`.
- Read-only latest-50 view; no filters, pagination, history, controls, role selection, new dependencies or general framework.
- Active admin required at the server data boundary; no browser grants, caller authority or raw secrets/errors.
- Application invitations never expire by age; accepted for sending does not mean delivered.
- Private HTML/RSC/redirect/denial responses, dynamic page, no shared data cache, navigation prefetch disabled.
- Preview and production only; all write fixtures disposable. No hosted changes, email, migration, staging or production publication.
- Preserve Native execution and one fresh whole-branch review; keep ticket In Progress until merge.
- Read installed Next `data-security.md`, `caching.md` and relevant page/link guides before application changes.
- `NODE` below means `/Users/rogerterrill/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`; existing dependencies are installed.

## Review Focus

- Admin loses permission or changes identity during the data read: return no rows (Task 1).
- Renewal overlaps querying: invitation and displayed attempt must come from one statement and the same generation (Task 1).
- Terminal lifecycle with unresolved send: show both facts without encouraging resend (Tasks 1–2).
- Database failure or malformed rows: unavailable rather than empty success or raw error (Tasks 1–2).
- Nested `/admin` RSC/prefetch and lookalike public paths: private policy matches complete path segments (Task 2).

---

### Task 1: Authorized minimal query and status DTO

**Files:** Create `lib/auth/invitation-admin-query.ts`, `tests/invitation-admin-query.unit.mts`; modify `lib/auth/invitation-send-provider.ts` (export existing bounded client factory only), `package.json` (include the new unit file).

**Interfaces:**
- Consume `getAccess():Promise<AccessResult>` and existing generated database types.
- Export the existing private factory as `createInvitationServiceClient()`; retain an internal alias so send behavior is unchanged. No new client abstraction.
- Produce `InvitationAdminRow={id:string;version:number;email:string;invitationStatus:string;sendStatus:string;updatedAt:string}`.
- Produce `InvitationAdminResult={status:'authorized';rows:InvitationAdminRow[];hasMore:boolean}|{status:'unauthenticated'|'forbidden'|'unavailable'}`.
- `InvitationQueryPorts={access:()=>Promise<AccessResult>;readRows:()=>Promise<unknown>}`; `listAdminInvitations(ports?:InvitationQueryPorts):Promise<InvitationAdminResult>` defaults to real access and the real bounded adapter.
- Query only `id,version,recipient_email,status,created_at,updated_at` and nested attempt `invitation_version,outcome,reconciled_outcome`. Order invitations by created_at descending then id descending, limit 51; nested attempts by version descending, limit 1. Use one PostgREST SELECT statement, `.retry(false)`, and existing no-store/deadline transport.

- [ ] Write focused unit assertions first. Denied/unavailable access performs zero privileged reads; authorized empty rows is distinct from unavailable; second access denial/error/different user discards rows. All seven lifecycle enums map to the exact spec labels; reconciled outcome wins; started/unknown map to Needs review; accepted to Accepted for sending; rejected to Send failed; absent/stale attempt to Not sent. Terminal+unknown retains both labels.

```ts
assert.deepEqual(await listAdminInvitations(deniedPorts), {status:'forbidden'});
assert.equal(privilegedReads, 0);
assert.deepEqual(await listAdminInvitations(emptyAdminPorts), {status:'authorized',rows:[],hasMore:false});
assert.equal((await listAdminInvitations(revokedAfterReadPorts)).status, 'forbidden');
// All harness ports and rows are explicitly fictional test values.
```

- [ ] Run `NODE --conditions=react-server --test tests/invitation-admin-query.unit.mts`. Expected: meaningful RED against absent/unimplemented query or incorrect labels.
- [ ] Implement the query in the new file. Authorize before constructing the service client; validate array, maximum 51 rows, UUID/positive safe version/email/timestamps/enums and at most one attempt. Derive current-generation send state only; explicitly construct the DTO. Recheck the same active admin before returning rows. Return at most 50 rows and hasMore only for a 51st row; catch errors into unavailable without logging private data.
- [ ] Add SDK request assertions using the existing fictional fetch pattern: exact column projection, invitation/nested ordering and limits, no proof/history selection, no retries, no-store/redirect policy, malformed payload failure and DTO secret exclusion. Observe relevant assertion RED before adapter implementation, then GREEN.
- [ ] Run `NODE --conditions=react-server --test tests/invitation-admin-query.unit.mts tests/invitation-send.unit.mts tests/invitation-resend.unit.mts` and `NODE node_modules/typescript/bin/tsc --noEmit`. Expected: all pass, existing send behavior unchanged.
- [ ] Commit the query and focused tests: `feat: add authorized invitation admin queries`.

### Task 2: Private read-only admin page and integrated evidence

**Files:** Create `app/(protected)/admin/invitations/page.tsx`; modify `app/(protected)/_components/app-shell.tsx`, `app/(protected)/dashboard/page.tsx`, `lib/http/protected-path.ts`, `tests/private-response.unit.mts`, `tests/helpers/access-fixture.mjs`, `scripts/verify-protected-app.mjs`, `tests/helpers/real-auth-app.mjs`, `scripts/verify-auth-integration.mjs`. Update only a short relevant contract paragraph in `docs/auth-callbacks.md`.

**Interfaces:** Consume Task 1's `listAdminInvitations()` result; page owns fixed unauthenticated redirect. AppShell accepts optional `isAdmin:boolean` (default false), which controls only link visibility. Existing real Auth fixture copies the actual admin page, shared components and protected layout; existing captured initial invitation supplies query evidence without sending extra mail.

- [ ] First extend existing private-path tests for `/admin`, `/admin/invitations` and descendants; `/administrator` and `/admin-public` remain unmatched. Expected RED from `NODE --conditions=react-server --test tests/private-response.unit.mts` before changing classifier.
- [ ] Extend the existing access fixture with minimal invitation SELECT response/control and server-secret canary; extend the existing protected-app script with the actual page assertions: anonymous fixed login, member/disabled denial, admin list and empty state, safe unavailable state, admin-only navigation, escaped recipient text, no private fields in denied HTML/RSC or browser assets, no-store headers on all outcomes. Run `NODE scripts/verify-protected-app.mjs` before page implementation. Expected: admin route/list assertions fail; inspect the failure rather than accepting unrelated setup errors.
- [ ] Implement the dynamic page and narrow classifier/link changes. Redirect unauthenticated to `/login?reason=authentication-required`; use AccessState for access failures and a safe invitation-load message for database failure. Render email, lifecycle label, send label and last update in an accessible responsive table; use plain escaped text. Empty copy: `No invitations yet.` Always state `Latest 50 invitations`; when hasMore, state `Older invitations are not shown.` Add no action buttons. AppShell admin link uses `/admin/invitations`, prefetch false; Dashboard passes its verified role.
- [ ] Run private-path tests and protected-app script again. Expected: all pass, including existing dashboard checks. Fix only failures introduced by this feature.
- [ ] Extend the real Auth fixture by copying the actual page/components/layout under its protected group. Add one query scenario after existing initial invitation issuance: admin sees recipient/current accepted send; anonymous/member/disabled admin cannot see it in HTML or RSC; all responses have private headers. Temporarily disable the owned admin, assert denial, then restore via existing setMembership for later scenarios. Use existing owned email/row cleanup; no new harness or provider sends.
- [ ] Add one paragraph describing the read-only page and VOLO-151 control boundary. Run installed Next typegen then tsc, ESLint, build, repository tests with fictional public env, Task 1 invitation units, private-response units and the affected protected-app check. Expected: all pass. Use webpack locally only if the documented Turbopack port limitation recurs; default CI build remains mandatory. Do not rerun unaffected local provider workflows.
- [ ] Commit: `feat: show private admin invitation statuses`. Push for existing CI once local checks pass. Expected: exact-HEAD validation and disposable database/Auth jobs pass; the Auth query scenario proves actual PostgREST relation shape and permissions. Add bounded diagnostics at a failing boundary before changing behavior; no unnecessary intermediate CI runs.
- [ ] Obtain one fresh whole-branch review, address material findings with RED→GREEN regressions, rerun affected checks and final exact-HEAD CI if code changes. Create/attach the PR when authorized, link concise evidence in Jira and leave the ticket In Progress until merge. Do not merge or publish.

## Self-review

Spec authorization/DTO/status/bounds requirements map to Task 1; presentation/cache/navigation and fixture evidence map to Task 2. All Review Focus cases have owning tests. Interfaces match, existing harness/client behavior is reused, and no migration, send change or future control implementation is included. Roger's inline execution preference persists; implementation begins after plan review.
