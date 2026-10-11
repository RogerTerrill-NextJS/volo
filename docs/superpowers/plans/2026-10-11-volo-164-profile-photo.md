# VOLO-164 Profile Photo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution or superpowers:subagent-driven-development if the user selects delegation. Steps use checkbox syntax for tracking.

**Goal:** Let active pilots safely upload, replace and remove their own profile photo.

**Architecture:** Upload originals directly into an owner-bound temporary Storage reservation to accommodate Netlify's binary payload limit. The server validates and normalizes the image, then atomically attaches an immutable final object. Persist cleanup state so failures can be retried without deleting the current photo.

**Tech Stack:** Next.js 16.3.8, Supabase Auth/PostgreSQL/Storage, TypeScript, Sharp 0.35.5, existing Node and pgTAP fixtures.

**Spec:** [Approved design](../specs/2026-10-11-volo-164-profile-photo-design.md).

## Global constraints

- Branch `feature/volo-164-profile-photo`; preserve user changes in AGENTS.md and docs/audits.
- Active members only can view final photos; owners only can initiate changes; admins have no override.
- JPEG, PNG and WebP input up to 5,000,000 bytes; exclude GIF, SVG and animation.
- Decode at most 25 million pixels; auto-orient; fit within 512 by 512 without enlargement; WebP quality 80; strip source metadata.
- Private `profile-photo-uploads` and `profile-photos` buckets; no overwrite/upsert or client final-object writes.
- Reservations expire after 15 minutes; one unexpired candidate and at most three outstanding candidates per owner.
- Existing profile required; photo never gates profile completion; preserve text form and Server Action limits.
- Fresh membership and Origin checks on each application mutation; private response headers; bounded Storage requests; safe feedback.
- Local owned write fixtures only. Hosted migrations, cleanup operation, scheduling and release require their separate authorization.
- VOLO-165 owns browser controls, photo display and accessible fallback.
- Focused tests, concise output and no duplicate harness or generic cleanup framework.

## Review focus

- Two tabs finalize/remove concurrently: the later stale candidate cannot replace a newer confirmed photo (Task 1).
- A Storage write finishes near reservation expiry/cleanup: it cannot recreate an untracked object after cleanup acknowledgment (Tasks 1 and 3).
- Upload content lies about its MIME type or contains EXIF location data: reject disagreement and publish only metadata-free normalized bytes (Task 2).
- Attachment succeeds but its response is lost: report uncertainty safely and preserve the now-current photo (Task 2).
- Owner becomes disabled before cleanup: user mutations fail, but obsolete files remain eligible for server cleanup (Task 3).

## File responsibilities

- `supabase/migrations/20261011030000_profile_photos.sql`: private buckets, photo-path grants, lifecycle table and narrowly scoped RPCs/policies.
- `supabase/tests/database/profile_photos.test.sql`: authorization, lifecycle and transaction assertions.
- `lib/profiles/photo-image.ts`: bounded download and decoding/normalization.
- `lib/profiles/photo-storage.ts`: domain-specific server-only privileged Storage operations, derived from reserved paths.
- `lib/profiles/photo-mutation.ts`: session RPC orchestration and existing mutation policies.
- `lib/profiles/photo-cleanup.ts`: claim/delete/acknowledge only eligible lifecycle records.
- `app/api/profile/photo/uploads/route.ts` and `app/api/profile/photo/route.ts`: thin guarded reservation/finalization/removal endpoints.
- `tests/profile-photo-image.unit.mts`: real image fixtures and processing limits.
- `scripts/verify-profile-photos.mjs`: focused real Storage plus compiled-endpoint verification using existing owned-stack helpers.
- `scripts/cleanup-profile-photos.mjs`: explicit-target operator cleanup command with dry-run by default.
- Existing profile pgTAP, migration upgrade verifier, database types, package files, fixture helper, CI and Supabase handoff: necessary integration changes only.

### Task 1: Private Storage permissions and atomic photo lifecycle

**Interfaces:** Create private `public.profile_photo_objects` with reservation UUID,
owner UUID, derived source/final paths, expected prior profile path, lifecycle state,
expiry and claim timestamps, and source-cleanup progress. No direct authenticated
table writes or member-readable lifecycle history. Use profile-first lock order.

Session RPCs: `reserve_profile_photo()` returns `{code,id,source_path}`;
`begin_profile_photo_finalize(reservation_id uuid)` returns `{code,id,source_path,final_path}`;
`attach_profile_photo(reservation_id uuid)` returns `{code}`;
`remove_profile_photo()` returns `{code}`. Derive owner from auth.uid(), verify
active membership and existing profile inside each function, and use fixed search paths.

Server RPCs: `mark_profile_photo_ready(reservation_id uuid)` and
`abandon_profile_photo(reservation_id uuid)` return `{code}`; `claim_profile_photo_cleanup(batch_size integer)` returns claimed IDs and exact eligible paths;
`ack_profile_photo_cleanup(reservation_id uuid,source_deleted boolean,final_deleted boolean)` returns `{code}`. Server RPCs are executable only by service_role.
Use bounded batches of at most 20, and 60-second renewable/recoverable claim leases.
Lease/state checks must stop a stale finalizer from reviving a claimed candidate.
An attached candidate remains identifiable for uncertain-response reconciliation.

- [x] Write focused pgTAP tests using literal owners A/B: B cannot change A's pointer or objects, admin B has no override, anonymous/disabled reads fail, active B reads only A's current final object. Direct photo-path INSERT/UPDATE fails; existing profile fields still save.
- [x] Add lifecycle assertions: one pending reservation/cap of three; expiry denies upload/finalize; expected-path mismatch leaves the current reference intact; removal is idempotent; ready/attach and cleanup claims cannot revive each other's records. Test rollback and lock ordering with owned database concurrency.
- [x] Run the new pgTAP file on an owned local stack and observe failures due to missing photo buckets/functions before implementing.
- [x] Implement the migration, private bucket limits and exact derived path policies. INSERT into the temporary bucket must lock/recheck its pending owner reservation in the Storage metadata transaction; no UPDATE/DELETE policies. Final SELECT requires active membership and a current profile reference. Revoke arbitrary photo-path column grants, leaving ordinary field grants intact.
- [x] Adjust existing `profiles.test.sql` only where the deliberate photo permission contract changes; keep existing ownership and field checks. Update both migration-history lists in `scripts/verify-invitation-upgrade.mjs`, regenerate database types and check them against fresh introspection.
- [x] Run focused profile/photo pgTAP checks with and without seeds; record actual counts and any failures. Commit this independently verified database change.

### Task 2: Image processing and guarded reservation/finalization endpoints

**Interfaces:** `normalizeProfilePhoto(bytes:Uint8Array,mime:string):Promise<Uint8Array>`
returns normalized WebP or a typed invalid-image error. `readProfilePhoto(response:Response):Promise<Uint8Array>`
enforces the actual 5,000,000-byte limit and ten-second deadline.

`profilePhotoPolicy(mode:'reserve'|'finalize'|'remove')` supplies the existing
`MutationPolicy` interface. Input is `{}` for reserve/remove or
`{reservation_id:string}` for finalize; reject every other field and non-UUID ID.
Results use `{code:'reserved',reservationId,sourcePath}` or
`{code:'saved'|'removed',cleanupPending:boolean}`; safe failures use
`invalid_image`, `conflict`, `limited` or `unavailable`. Map domain failures to an
appropriate HTTP status rather than presenting an outer successful guard as a save.

`photo-storage.ts` exports only `downloadReservedPhoto`, `uploadNormalizedPhoto`
and `deletePhotoObject`, taking the server-derived reservation/path data from Task 1.
Use lazy privileged configuration and a fresh server-only client with session
persistence/refresh disabled. No client receives a secret, arbitrary object URL or raw provider error.

- [x] Write `profile-photo-image.unit.mts` using real small JPEG/PNG/WebP buffers generated with Sharp. Assert 512px maximum, preserved aspect ratio, no enlargement, WebP output, stripped EXIF, and rejection of empty/corrupt, MIME-mismatched, GIF/SVG, animated and over-25-million-pixel inputs. Assert a 5,000,001-byte response is rejected even without Content-Length; stalled response bodies cancel at the deadline.
- [x] Run the unit test and observe missing processing-module failures. Declare Sharp 0.35.5 directly in package.json/lockfile, implement only the specified processing contract, and rerun the test to green.

The core processing expectation uses a real generated image, not a mock decoder:

```ts
const input=await sharp({create:{width:1024,height:512,channels:3,background:'red'}}).png().toBuffer();
const output=await normalizeProfilePhoto(input,'image/png');
const metadata=await sharp(output).metadata();
assert.equal(metadata.format,'webp');
assert.equal(metadata.width,512);
assert.equal(metadata.height,256);
assert.equal(metadata.exif,undefined);
await assert.rejects(()=>normalizeProfilePhoto(input,'image/jpeg'));
```

Use `node --conditions=react-server --test --test-reporter=dot tests/profile-photo-image.unit.mts`
for the image unit test. Its missing-module failure precedes implementation; green
requires all literal format/size/pixel and deadline assertions to pass.

- [x] Extend the existing compiled mutation fixture with an explicit photo option to copy real endpoints. Extend its backend at the external Storage/RPC boundary only; keep actual access, Origin checks, policies and SDK clients. Add endpoint assertions to the focused verifier: bad Origin/anonymous/disabled/no-profile calls produce zero photo effects; foreign reservation IDs and extra fields are denied; reserve emits owner-derived paths.
- [x] Implement the three routes with installed Next.js guidance. Reservation/finalization use bounded JSON and `handleRouteMutation`; removal enters `runMutation` with strict empty-input handling. Keep DELETE's body contract explicit and reject resource identifiers in the query string.
- [x] Implement Task 1 RPC orchestration: claim finalization, download/check MIME/process, upload final object without overwrite, mark ready and session-attach. Include a ten-second Storage request deadline covering response bodies and no automatic write retries. Use existing session client for owner functions and privileged client only for approved domain operations.
- [x] Add failure scenarios before final implementation: rejected image preserves old pointer; upload failure abandons candidate; delayed/lost attach response followed by observed current reference does not delete it; membership revoked between reserve/finalize/attach denies the remaining mutation. Return cleanup-pending separately from the confirmed result.
- [x] Run focused image/endpoint verification, existing profile-save/edit/completion regressions, typegen/tsc and lint. Commit after failures are resolved.

### Task 3: Retryable cleanup and real Storage verification

**Interfaces:** `cleanupProfilePhotos(limit:number):Promise<{deleted:number;pending:number}>`
claims at most 20 eligible records, performs Storage API deletion, and acknowledges
only confirmed absent/deleted paths. Current lifecycle rows survive temporary-source
cleanup; obsolete records disappear after all relevant objects are gone. Claims
can be recovered after their lease without permitting a stale worker to affect current objects.

The operator script requires an explicit Supabase project reference matching the
configured URL, defaults to dry-run, and requires `--execute` for deletions. Do not
print paths, images or credentials in summaries. Tests use the existing owned
local stack and explicit loopback validation, never the developer's hosted environment.

- [x] Add real-service scenarios to `scripts/verify-profile-photos.mjs` using `tests/helpers/local-auth-stack.mjs` with an isolated state file and explicit owned cleanup. Reuse provisioning/login helpers and the compiled Next app; do not add another Docker lifecycle implementation.
- [x] Assert normal reserve/direct temporary upload/finalize/member-read/removal with real Storage. Test maximum accepted size at 5,000,000 bytes, reject 5,000,001 bytes, and verify another pilot cannot upload to the reservation, overwrite, move or delete the object. Deny public downloads and temporary-object reads.
- [x] Exercise old-object deletion failure, expired candidates, disabled owner cleanup, already-missing objects and concurrent attach/remove/cleanup. Physically download/list with the owned service fixture to prove deletion rather than merely asserting storage.objects rows disappeared.
- [x] Test Storage upload overlapping expiry/cleanup and aborted final uploads. Confirm no object is recreated after its cleanup record is acknowledged. If the pinned Storage service cannot serialize this through the proposed policy lock, stop and revise that lifecycle mechanism; do not claim the race is covered using only a fake backend.
- [x] Implement `photo-cleanup.ts` and the dry-run operator command. Attempt cleanup after confirmed mutations and failed candidates; retain work after failures. Never delete a current referenced final object; use exact claimed paths and Storage API operations only.
- [x] Integrate the focused verifier into the existing real-service CI job as a separate named step, with its own always-run owned-stack cleanup and sanitized summary. Reuse the job's installed dependencies; do not introduce a new CI job/stack framework. Add the unit test to the appropriate existing Node test invocation without making ordinary offline smoke tests start Docker.
- [x] Run the real Storage verifier to green, then the existing database upgrade verifier (new migration changes its permissions/history). Check generated types, focused lint and tsc. Broaden further only for failures or shared boundary changes.

Run `node scripts/verify-profile-photos.mjs` for the owned real-service checks and
`node scripts/verify-profile-photos.mjs --cleanup` for recovery of only its recorded
owned stack. Run existing application regressions with
`node --test --test-reporter=dot tests/profile-save.test.mjs tests/profile-edit.test.mjs tests/profile-completion.test.mjs`.
The real verifier must clear its owned photo objects/lifecycle rows before removing
its fictional Auth users or handing teardown to the existing stack helper.

- [x] Update docs/supabase-setup.md with verified outcomes and the VOLO-165 interface: reserve → session upload with upsert false → finalize; safe result codes; optional photo state; authenticated serving recommendation; no raw source URLs. Record daily hosted cleanup as a launch prerequisite pending separate approval, and distinguish local verification from preview/release evidence.
- [x] Request one read-only whole-branch review, address material findings, run targeted checks for any corrections and commit the completed feature. Do not push/create a PR until the user requests it.

## Handoff

No product/schema code has been written while planning. Recommend native execution
in this session because the three tasks share lifecycle invariants and tightly
coupled RPC interfaces. The user reviews this plan and chooses native or delegated
execution before implementation. A normal approval without a different preference
confirms the recommended native approach.


## Execution record — 2026-10-11

Implemented on `feature/volo-164-profile-photo`. The final read-only review found
two P2 cleanup issues; both were reproduced by failing tests and fixed in one
pass: owner-scoped pending counts include leased/unselected work, and total
cleanup budgets prevent slow batches from outliving their leases. No deferred
minor findings remain.

Verification: 76 focused database assertions; five image/cleanup unit tests;
12 owned real Storage and compiled endpoint scenarios; three existing profile
save/edit/completion regressions; 20 owned Auth fixture/session helper checks;
focused lint and TypeScript. An owned prior-schema upgrade preserved three
fictional Auth/membership fixtures and matched generated types exactly. Full
application tests and the GitHub-only invitation concurrency verifier were not
run locally. Netlify preview and production release have not been verified.

Execution decisions and costs:

- Kept the approved existing branch/checkout and preserved user edits; this gives
  less isolation than another worktree.
- Applied project-focused testing instead of skill blanket full-suite repeats;
  unrelated regressions can remain for CI.
- Pinned Storage v1.79.28 commits metadata as superuser after the RLS probe.
  A bucket-specific lifecycle trigger fences late commits; Storage upgrades must
  reverify this integration. Photo revisions fence null-pointer removal races;
  claim tokens fence stale cleanup acknowledgments.
- Reused the real Auth compiled-app fixture rather than a duplicate fake backend;
  these endpoint checks require Docker.
- Preserved the invitation verifier's GitHub-hosted-only guard. Local upgrade
  verification covered changed schema; invitation-specific races remain for CI.
- Browser controls/display/accessibility remain VOLO-165. Hosted migration,
  daily cleanup scheduling, preview verification and release remain separately
  authorized operations; they are pending launch work.

The cleanup claim RPC adds optional server-derived `cleanup_owner` and returns
`lease_until`. The service-only `count_profile_photo_cleanup(cleanup_owner)`
counts outstanding work including active leases. Acknowledgments include the
claim token. Inline cleanup has a two-second total budget plus a one-second
status read; operator cleanup has a forty-second total budget. Unfinished work
remains persisted. SQL and image modules had observed missing-module/schema
failures before implementation; endpoint assertions were added after their
orchestration. Both final-review regressions were observed red before the fix.

The implementation remains committed locally for the user's PR request. Daily
hosted cleanup is a launch prerequisite; no hosted changes or release occurred.
