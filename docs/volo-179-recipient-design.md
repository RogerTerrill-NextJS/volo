# VOLO-179 — Authorized private recipients

Approved approach: the user approved the recommended approach and requested a PR.
Implementation proceeds inline on feature/volo-179-private-recipients from merged
VOLO-178 (aabd290). This records the approved scope and concrete interfaces.

## Boundaries

Reuse current access checks, directory pagination/projection, bounded forms,
completed-profile creation, session clients and NETWORK/PRIVATE RLS. No new tables,
columns, dependencies, picker UI or lifecycle decisions. Target recipients need
current active membership; do not invent a new target-profile requirement. Directory
presentation continues to show active licensed profiles, excluding the viewer.

## Atomic creation

Keep the existing create_flight RPC and eight-argument contract unchanged. Add
create_private_flight with the seven content arguments (no visibility argument)
and p_recipient_ids uuid[]. It invokes existing guarded PRIVATE creation and adds
all recipients in the same transaction. Reject null/duplicate/self/inactive/absent
IDs, non-one-dimensional arrays, empty selections and oversized selection payloads.
Recipient-array text has the existing 16 KiB transport ceiling; this bounds one
operation, not the total number of recipients a flight can ever have. Any failure
rolls back the newly created flight and all selections. Lock target membership rows
in UUID order with shared locks until commit. Owner identity and eligibility still
come from create_flight/auth.uid(), never the form.

The application accepts an optional recipient_ids JSON UUID array within the
existing bounded form. Absent/empty selections preserve the staged owner-only
PRIVATE path. Nonempty selections require PRIVATE and invoke the atomic RPC.
NETWORK with selected IDs is rejected. Return safe UUID/count confirmation only;
confirmation must describe selected recipients accurately even before the picker UI.

## Recipient changes

change_flight_recipient(p_flight_id uuid,p_recipient_id uuid,p_selected boolean)
returns the confirmed flight UUID. Only authenticated execution is granted. Derive
current identity, share-lock its active membership, then lock the flight for update
and verify actual owner/PRIVATE mode. No ordinary-admin bypass. Add checks current
active target membership under a shared lock; duplicate add and repeated removal
are idempotent. Removal can revoke disabled targets too. Never grant direct member
INSERT/UPDATE/DELETE or accept caller-selected owner/role/status.

The server operations use existing mutation guards, validate exactly two UUID
fields, load ownership through the session client, reuse canEditFlight, and let SQL
independently recheck after locking. Use the existing five-second request/body
boundary, no-store/redirect:error and retry(false). No automatic uncertain-write retry.

## Removal safeguard and handoff

The approved VOLO-172 rule remains: cancel pending/accepted request, release derived
capacity, close sending and preserve active-participant read-only history atomically
under the common flight lock, then remove selection. Current schema has no request
or conversation tables, so only no-request removal can occur now.

Before deleting, while holding the flight lock, reject removal with a static
lifecycle-unavailable outcome if public.flight_requests or public.conversations
exists. This fails closed until their owning migration replaces the safeguard with
the real atomic cancellation/closure/history operation. Do not create empty future
tables or guess their columns. Request creation/acceptance must use the same flight
lock; request/conversation features must integrate removal before exposure. This is
a technical safeguard, not a new removal product rule or a claim that history works.

## Candidate query

Wrap listDirectoryProfiles with its existing stable UUID cursor/page-size/search
bounds and fresh access checks. Exclude the verified viewer without accepting an
owner grant as input. Return only user_id, display_name, home_airport and photoAvailable
plus the original next cursor. Filtering can leave a short/empty page with a next
cursor; consumers continue pagination. Candidate results never substitute for final
membership checks. No account emails, membership status/reason or storage paths.

## Verification

Use focused pure validation/query tests, pgTAP SQL authorization/rollback/fence tests,
and existing real Auth/compiled-action fixtures. Verify active owner and targets,
self/duplicate/absent/disabled/foreign/admin denial, retained-session revocation,
atomic all-or-nothing creation, direct-write denial, selected/unrelated RLS, removal
and re-add, and the future-table safeguard. Test concurrency under the flight lock
on owned local data. Regenerate actual public types and append migration history.
No hosted write, deployment, release or Jira mutation is authorized.
