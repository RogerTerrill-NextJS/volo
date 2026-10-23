# VOLO-193 — Atomic owner request decisions

## Intent and scope

Give flight owners one authoritative database operation for accepting or declining
an incoming request. Acceptance must never oversubscribe a flight, including when
two owners' browser tabs act on stale capacity. VOLO-66 is the parent authority;
VOLO-194 adds application actions and owner-view controls afterward.

This is a small extension of the existing request lifecycle. Reuse the existing
request record, eligibility checks, flight lock, timestamp trigger and local test
infrastructure. No connection/conversation state, notifications, new UI, privileged
application client or hosted changes are included.

## Approaches

The user selected one restricted accept/decline RPC. It keeps authorization,
request binding, locking and result conventions together. Separate accept and
decline RPCs would provide distinct names but duplicate that shared boundary.
Direct authenticated table updates are unsuitable because they would broaden the
existing closed mutation surface and bypass the guarded operation.

## Operation

Proposed builder choice: `public.decide_flight_request(p_flight_id uuid,
p_request_id uuid, p_decision text) returns jsonb`. Only `accepted` and `declined`
are valid decisions. Require non-null identifiers; reject unsupported input with
SQLSTATE `22023`. Derive the actor solely from `auth.uid()`.

Use a fixed empty search path and fully qualified objects. Revoke default execute
permissions, including anonymous and service-role execution, then grant execute
only to `authenticated`, consistent with the existing submission RPC. Verify
current active membership and actual flight ownership; unrelated administrators
have no bypass. Missing and foreign flights share the same authorization denial
(`42501`) without returning flight/request data.

Acquire the common flight `FOR UPDATE` lock before reading/updating the request,
then lock the request constrained by both its UUID and the locked flight UUID.
An unknown or mismatched request returns a bounded unavailable result. Keep the
existing immutable identity, note and timestamp rules; change only request status.
Authenticated direct inserts/updates/deletes remain closed.

## State, eligibility and results

Only pending requests can change to accepted or declined. A repeat of an already
confirmed matching decision is a no-op confirmation, preserving all timestamps
and the introduction. A different decision on an accepted/declined request, or a
decision on a withdrawn/cancelled request, returns a conflict without mutation.
No terminal request is revived, and this operation cannot cancel acceptance.

Before pending-to-accepted, while holding the flight lock, verify that the flight
is open and future, owner/requester memberships remain active, the requester has
a complete licensed profile, and PRIVATE selection still exists. Count accepted
requests against `pilot_places` under that same lock. The existing persistence
trigger remains a second enforcement boundary. Full capacity returns a distinct
capacity result and leaves the request pending.

Pending-to-declined requires the current active owner and correct request binding.
It preserves the existing terminal-closure policy: a pending request can be closed
after departure, flight closure or requester disablement. It consumes no capacity
and never broadens requester eligibility. Recipient removal already cancels
pending/accepted requests; a later decision cannot override that cancellation.

Proposed builder choice: fixed JSON codes for confirmed decision, matching repeat,
unavailable request, conflict, ineligible acceptance and full capacity. Confirmed
results contain only the bound request UUID and accepted/declined status. Failure
results expose no requester details, other accepted requests, provider diagnostics
or remaining-capacity count. VOLO-194 will map these outcomes into user feedback.

## Verification and delivery

Extend the existing pgTAP request tests and lock/session fixtures. Cover owner and
unrelated-admin authorization, disabled actors/targets, invalid input and binding,
all legal/illegal states, note/identity/timestamp preservation, idempotent repeats,
open/future/profile/PRIVATE eligibility, full capacity and closed direct writes.
Check function search path and execute grants.

Observe actual PostgreSQL lock contention for two pending approvals competing for
one place: one accepted, one capacity result, exactly one accepted row. Also cover
same-request retries/opposing decisions and ordering against PRIVATE recipient
removal through the existing fixture machinery. Never substitute concurrent HTTP
issuance for evidence of overlapping transactions.

Add the migration, regenerate public database types from the owned local schema,
and verify relevant upgrade preservation without running unrelated historical
tests. Record focused checks and limitations in a VOLO-193 verification document.
Use `feature/volo-193-owner-request-decisions` from merged VOLO-192 (`4018fab`).
Preserve unrelated local `AGENTS.md` and `docs/audits/` changes.

The user has requested a PR after implementation. No hosted data/settings changes,
migration application, merge or release is authorized by this design. Netlify
Deploy Previews remain automatic; production publishing stays locked.
