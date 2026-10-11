# VOLO-164: Protected profile-photo upload and replacement

## Purpose and approved product choices

Allow an active pilot with an existing profile to upload, replace or remove their
own photo without changing another pilot's data or losing the current photo after
a failed replacement. Photos are optional and never gate profile completion.

The user approved these recommendations on October 11, 2026:

- Only active VOLO members can view profile photos.
- Accept JPEG, PNG and WebP up to 5 MB (5,000,000 bytes); exclude GIF and SVG.
- Delete replaced/removed objects after confirmation; retain no photo history.

VOLO-164 delivers the storage policies, upload/removal endpoints and cleanup
contract. VOLO-165 delivers profile-photo controls, display and accessible fallback.
No cropping interface, gallery, account-erasure feature or hosted release belongs
to this ticket. The existing AGENTS.md and untracked audit documents are preserved.

## Approach

Use private temporary and published-photo Supabase Storage buckets, retaining the
existing fresh membership and Origin checks. Upload originals directly into an
owner-bound temporary reservation, then validate and normalize them on the server
before publishing under an immutable name and atomically changing the profile reference.

A single server-mediated upload would simplify transport, but Netlify limits binary
requests to approximately 4.5 MB and cannot accept every approved 5 MB file. Direct
upload into the final photo bucket would bypass image processing. Private temporary
upload followed by server finalization preserves the approved size and processing
boundaries. Overwriting a fixed filename risks the current photo during a failed
replacement and complicates caching; immutable paths avoid that problem.

## Image and request boundaries

POST `/api/profile/photo/uploads` reserves one temporary object and returns its
server-generated upload path and reservation ID. The browser uses the existing
session Supabase client to upload directly to `profile-photo-uploads`, with upsert
false. POST `/api/profile/photo` accepts only the reservation ID to finalize the
photo. DELETE at that endpoint removes the current owner's photo and accepts no
resource ID. Neither application request accepts a user ID, bucket, object path or
ordinary profile fields. Each method enters the existing mutation guard with fresh
active membership, Origin verification and an existing-profile requirement. Admins
have no cross-owner override. JSON metadata uses existing bounded readers, and
responses use existing private/no-store headers and safe error messages. No global
request or Server Action limit is increased.

The temporary bucket enforces the 5,000,000-byte bound and the approved MIME types.
During finalization the server independently bounds the downloaded response by
actual bytes, including responses without Content-Length, with a ten-second read
deadline and cancellation. Reject missing objects, empty files and over-limit data.
The upload's filename or declared MIME type alone is not proof of image contents.

Declare the already-installed Sharp version as a direct application dependency.
Check the decoded format as well as the submitted MIME type, require agreement,
reject animation/multiple frames and invalid/truncated images, and limit decoded
input to 25 million pixels. Auto-orient and resize to fit within 512 by 512 pixels
without enlargement, preserving aspect ratio. Encode WebP with quality 80 and no
source metadata. Reject oversized output rather than silently exceeding the bucket
limit. Delete original temporary files as part of cleanup and never retain original
filenames. This bounds processing and strips embedded location/EXIF data; it is not a malware-scanning service.

## Storage and database permissions

Create private `profile-photo-uploads` and `profile-photos` buckets in a versioned
migration. Temporary objects permit JPEG/PNG/WebP; final objects permit WebP. Both
enforce 5,000,000 bytes. Generate temporary paths as
`<verified-user-uuid>/<random-reservation-uuid>/source` and final paths as
`<verified-user-uuid>/<random-reservation-uuid>.webp`; never use user filenames.

Authenticated clients can INSERT only at their unexpired pending reservation in
the temporary bucket, while still active and possessing a profile. They cannot
UPDATE/overwrite objects, move them, read other pilots' temporary files or DELETE
them. Authenticated clients have no direct INSERT/UPDATE/DELETE policy in the final
bucket. The narrowly scoped server photo operation uses the existing server-only
privileged configuration to store processed bytes and delete approved garbage
paths. Each privileged operation derives its destination from database lifecycle
records, after authorization, rather than request input. Do not expose the key or
introduce a generic arbitrary-bucket privileged API.

Final-bucket SELECT permits active members to read only objects referenced by a
current profile. Temporary objects are not member-readable; an owner may obtain
only the minimal SELECT permission needed for their upload API operation if the
pinned Storage API requires it. Pending final objects and obsolete objects are not
member-readable. Anonymous, disabled and unadmitted sessions cannot read photos. VOLO-165 should serve images through a
freshly authorized, no-store application response using the session Storage client;
avoid public bucket URLs and bearer signed URLs that outlive membership checks.

Remove authenticated INSERT/UPDATE grants for `profiles.photo_storage_path` and
replace arbitrary path updates with specific database functions. Existing ordinary
profile saves continue to preserve the photo. A small private lifecycle table tracks
the server-generated path, owner, expected previous path, state and expiry. It is
not a member-visible photo history; obsolete records are deleted after physical cleanup.
No public function accepts a foreign owner or arbitrary object path.

## Upload, replacement and removal

After authorization, reserve an owner-bound candidate in the database before
accepting the direct temporary upload. Reservations expire after 15 minutes. Limit
each owner to one unexpired candidate and at most three outstanding candidates
including expired/cleanup-pending records. When that cap is reached, require cleanup
before another reservation. Abandoned candidates therefore cannot grow without bound.
The finalize endpoint verifies reservation ownership/expiry, downloads the exact
reserved temporary object, validates and processes its bytes, and uploads the
normalized final object. A candidate progresses from pending to ready only after
the privileged server confirms the processed final upload. Marking ready must match
the reserved owner/path and
must not revive an expired or cleanup-claimed candidate.

The session-bound attach function locks the owner's profile and validates current
membership, ready candidate ownership, expiry and the expected previous path.
It atomically sets the new profile path, marks the new object current and marks
the old object for cleanup. Conflicting replacements return reload-before-retry;
they never overwrite a newer confirmed change. Normal profile edits cannot change
these lifecycle fields. Attachment and cleanup claiming use consistent locks.

A failed upload, processing step or attachment leaves the prior profile reference
intact and makes the candidate eligible for cleanup. Concurrent finalization of one
reservation requires an atomic claim/lease; duplicate requests cannot rewrite a
final object or advance an expired reservation. Storage INSERT also checks the
reservation remains pending, so expiry/cleanup claims cannot be followed by a late
new upload. Storage insertion and cleanup claiming must serialize on the candidate
record; a policy check performed before cleanup is not sufficient for an upload
that remains in flight. Verify this race with the real local Storage service.
Original temporary files become cleanup-eligible after confirmation. If a response
is uncertain, reread the profile
and lifecycle state before attempting deletion; never delete a possibly current
object merely because the request timed out. No automatic upload retry.

Removal atomically clears the current owner's reference and marks the former object
for cleanup. It is idempotent when no photo exists. Once the reference is cleared,
the object immediately loses member read access even if physical deletion is delayed.
Disabled members cannot invoke removal; cleanup may still delete obsolete objects
through the server-owned cleanup operation.

## Cleanup and retention

Attempt physical cleanup immediately after a confirmed switch or removal. Delete
through the Storage API, never by deleting storage.objects metadata in SQL. Retain
failed work in the lifecycle table. Return separate confirmed-change and
cleanup-pending outcomes so the UI does not tell a pilot that a successful change
failed, or claim physical deletion that has not happened.

Provide a focused bounded cleanup command for obsolete and expired candidates.
Before deleting, atomically claim eligible records and verify their final paths
are not current profile references; claimed records cannot subsequently attach or
authorize a new temporary upload. Remove the temporary and, when obsolete, final
objects. Successful current objects retain only the minimal current lifecycle row
needed for ownership and safe cleanup; delete obsolete lifecycle records after
confirmed physical deletion. Treat already absent Storage objects as successful cleanup, and acknowledge records only after
confirmed deletion. Recover stale cleanup claims for retry. Cleanup is idempotent
and must not depend on the original owner's continued active membership.

The command supports owned local fixture verification and a separately approved
operator run against a named hosted project. Document a daily production cleanup
operation as a launch prerequisite, including failed-run reporting. Scheduling and
hosted execution are separately approved operations, not silently enabled by this
ticket. Until that operation is enabled, delayed deletion has no guaranteed wall-clock
bound; the launch checklist must record this limitation. Backups follow the existing
provider/account retention policy; deletion is not a promise to erase backups.

## Focused verification

Reuse the owned local Supabase stack and compiled Next.js fixtures. Meaningful new
coverage includes real Storage upload/read/delete behavior, active-member reads,
anonymous/disabled denial, foreign-owner overwrite/delete denial, direct path-write
denial, byte/format/pixel limits, successful replacement/removal, rejected upload
preserving the old photo, concurrency conflict, uncertain attach results and
cleanup retries without deleting the current object.

Run focused pgTAP policies and photo integration tests, existing profile-save/edit
and completion regressions where touched, type generation, TypeScript and focused
lint. Update the existing migration-history upgrade verifier for the new migration
and regenerate database types. Broader database upgrade verification is warranted
by new permissions/functions; the unrelated application suite is not automatically
required. Keep successful output concise.

## Delivery and handoff

Use `feature/volo-164-profile-photo` from merged main. Review this written design,
then prepare a short implementation plan for review before application/schema code.
Record local evidence and cleanup operation prerequisites in the existing Supabase
handoff documentation. Netlify Deploy Preview and production release verification
are separate. No hosted bucket/migration, profile writes, cleanup or production
publication is authorized by local implementation approval.

## Sources

- [Netlify function payload limits](https://docs.netlify.com/build/functions/configuration/)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase object deletion](https://supabase.com/docs/guides/storage/management/delete-objects)
- [Supabase bucket limits](https://supabase.com/docs/guides/storage/uploads/file-limits)
- [Sharp input limits](https://sharp.pixelplumbing.com/api-constructor/)
- [Sharp output and metadata behavior](https://sharp.pixelplumbing.com/api-output/)
- Installed Next.js route-handler and Server Action guides in node_modules/next/dist/docs.
