# VOLO-176 — Approved guarded flight creation

Review proposal for [VOLO-176](https://outsidethecockpit.atlassian.net/browse/VOLO-176)
and parent [VOLO-46](https://outsidethecockpit.atlassian.net/browse/VOLO-46).
Branch: `feature/volo-176-flight-creation`, based on merged VOLO-175 (`d6bfc8c`).
The user approved this write contract in chat. Implementation and focused local
verification are recorded in [verification](volo-176-verification.md).

## Outcome and boundaries

Allow an authenticated active member with a completed licensed-pilot profile to
create an upcoming flight through the existing protected Server Action boundary.
The database must derive the owner and enforce eligibility even when its creation
function is called directly through Supabase. Return only a creation result and
flight UUID. No directory/feed/form UI, recipient-selection UI, edit/cancellation
operations or new lifecycle rules belong to this ticket.

Prerequisites are ready: VOLO-173 flight tables, VOLO-174 visibility policies and
VOLO-175 shared validation are merged. The installed Next.js forms and data-security
guides were read; they require independent authorization inside mutations.

## Recommended write interface

Add one additive migration with `public.create_flight` callable by authenticated
sessions, using a narrow security-definer implementation with an empty search path
and fully qualified relations. Revoke public/anonymous/unneeded execution.
Do not grant ordinary clients INSERT/UPDATE/DELETE on the tables.

The function accepts normalized content fields: departure/destination airport,
UTC departure instant, departure zone, aircraft description, joining-pilot capacity,
notes and NETWORK/PRIVATE visibility. It accepts no owner, UUID, status, timestamp,
local-date override, remaining-place counter or recipient IDs.

Within one transaction:

1. Derive the caller from `auth.uid()` and deny a missing identity.
2. Lock/check the caller's current membership as active, then lock/check their
   profile row. Existing profile constraints establish completion and licensed
   designation; there is no separate client-supplied completion claim.
3. Require a finite departure strictly after current database time immediately
   before insertion. This recheck protects against stale application prechecks.
4. Insert normalized content with the derived owner, database-generated flight ID,
   initial open status and server-managed timestamps. Existing constraints/triggers
   enforce airport/text/capacity/zone bounds and derive the local date.
5. Return only the created UUID. Failures roll back; eligibility cannot be retained
   merely by presenting an older JWT or racing a membership disable.

Use shared-lock ordering consistently (membership, profile, then new flight). This
keeps eligibility changes from committing between the final database check and
insertion. Missing/disabled callers receive generic permission denial; invalid
content receives safe validation failure, without private metadata.

Both approved visibility values remain available. A PRIVATE flight created without
recipient rows is visible only to its active owner. This operation creates no
recipient rows; selected-recipient posting integration remains with VOLO-178/179.
No minimum recipient-count rule is invented here.

## Server Action and error behavior

Add a server-only creation policy/operation plus `createFlight` Server Action,
following the existing profile action conventions. The operation uses the
user-session Supabase client, not a blanket secret client.

- Reuse `handleActionMutation`/`runMutation` for trusted-origin checking, fresh
  verified identity/current membership, role checks, bounded form input and the
  existing `requireCompleteProfile` gate. A 16 KiB form limit accommodates the
  approved bounded fields without permitting arbitrary payloads.
- Reuse `validateFlight`, including the approved DST choices. Require a future
  UTC departure on the server, then rely on the database's final time check.
- Reject protected/unexpected fields. Map the validated content explicitly into
  the RPC arguments; derive ownership only inside the database function.
- Preserve existing private/no-store mutation responses and session boundaries.
  No request body, email, membership metadata, database error detail or secret is
  returned to the caller.
- Apply a bounded request/body deadline and disable automatic write retries.
  Report success only after a valid created UUID is confirmed. If the response is
  lost or times out after a possible commit, return a safe unconfirmed outcome
  instructing the caller to verify before retrying. This is not an exactly-once
  or new idempotency-key feature.

Production UI does not expose the action until its owning form ticket imports it.
A focused disposable compiled fixture can import it now to prove the real native
and fetched Server Action paths independently of page guards.

## Alternatives considered

A narrow session RPC is recommended because it keeps identity and eligibility at
the write boundary and preserves disabled direct table writes. Column-level INSERT
permissions plus RLS would require opening a second direct write surface and
encoding the same completion/time rules there. A secret-client insert would bypass
ordinary session RLS and require additional manual concurrency protection. Neither
alternative is needed for this scope.

## Focused verification

Reuse existing owned local Supabase/Auth and mutation fixtures; do not build a
second harness or use hosted data/accounts/settings.

- SQL/direct RPC: active completed member/admin creates one owned upcoming flight;
  anonymous, missing membership, disabled and missing-profile callers cannot.
  Invalid/past departure and protected-owner attempts cannot create records.
  Verify final database-time checking, current eligibility, safe UUID-only return,
  preserved NETWORK/PRIVATE reads and continued direct-table write denial.
- Shared validation: reuse VOLO-175's date/DST/field matrix, adding only the future
  creation gate. Do not duplicate the entire matrix at every transport.
- Compiled Server Action: valid owner-derived creation, current-member/profile and
  origin denial, oversized/protected input, private response headers, and an
  unconfirmed response that does not cause an automatic duplicate write.
- Regenerate public database types using actual local CLI introspection, update the
  existing migration-history allowlist, and run focused SQL/action tests, types and
  lint. Broader release/CI checks remain in the established workflow.

No production migration, hosted write fixture or deployment is authorized by this
implementation ticket. Netlify preview and production verification stay separate.

## Review

The user approved this write contract, including PRIVATE creation without selected
recipients at this stage. No new database columns or unrelated founder lifecycle
decisions are proposed. The implementation plan identifies exact files and checks
for execution review.
