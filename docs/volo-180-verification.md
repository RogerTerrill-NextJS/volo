# VOLO-180 — Private recipient picker

Approved bounded scope, implemented on `feature/volo-180-recipient-picker` from
merged VOLO-179 (`d43b98a`). The user approved the design and requested PR creation.
The installed Next.js forms and Server Actions guides were read before coding.

## Behavior

The posting form shows the picker for PRIVATE only. It searches existing directory
candidates by display name or home airport, follows stable cursor pages of 20, and
excludes the viewer through the existing recipient query. A short or empty page
with a cursor still offers the next page. Accessible checkboxes and a removable
selected list retain choices across queries, pages and validation errors. Switching
to NETWORK clears selected pilots and removes the recipient payload.

Both client validation and the guarded posting policy require at least one pilot
for PRIVATE. Existing lower-level owner-only creation remains compatible; this
minimum applies to the actual posting form. The form serializes a bounded UUID
array through the existing 16 KiB mutation boundary. Submitted names and metadata
are never trusted or echoed. Validation recovery retains validated IDs, with labels
from existing client query results; native recovery can show an ID placeholder.

Search has loading, empty, invalid and unavailable feedback, and stale/unmounted
responses cannot replace current results. Directory access is checked freshly on
every query. Final target eligibility remains the atomic VOLO-179 RPC's decision.
Its known invalid-selection outcome maps to static picker feedback without exposing
raw errors. Other creation errors retain existing safe handling. Uncertain writes
stay blocked against immediate resubmission and are never automatically retried.

No schema, RLS, dependency, eligibility or recipient-removal lifecycle changes.
Selecting private recipients requires JavaScript, with an explicit noscript message;
server validation prevents an accidental owner-only PRIVATE post without selection.

## Verification

| Check | Result |
| --- | --- |
| New recipient minimum/recovery tests before implementation | Expected behavioral failures |
| Focused flight/profile/recipient/directory units | 36 passed |
| Real Auth, compiled posting actions and session database access | 18 scenarios passed |
| Next route type generation / TypeScript | Passed with fictional loopback build configuration |
| Focused ESLint / whitespace check | Passed |
| Independent read-only review | No actionable findings |
| Local mobile browser, 390 × 844 | Passed; document width 390, no horizontal overflow |

Integration reuses the existing fixture and visibility assertions. Actual native
and fetched posting verify selected active recipients can read and unrelated active
admins cannot. It also checks empty PRIVATE rejection before RPC, invalid target
rollback with safe feedback and retained IDs, NETWORK carryover rejection, stale
membership, guards, uncertain writes and existing recipient lifecycle boundaries.
No parallel copy of the visibility matrix or new test harness was introduced.

Browser verification used 22 fictional candidates on an owned disposable local
stack. Space toggled a checkbox; advancing to the second page retained it and moved
focus to the results heading. Selecting there and searching KSQL retained both
choices. Name search, no matches, search-length feedback, removal, client validation
recovery, PRIVATE minimum and NETWORK clearing were checked. A valid PRIVATE post
confirmed and its database row contained exactly the chosen pilot. All owned local
resources were cleaned after verification.

## Modified files

- `app/(protected)/dashboard/flights/new/actions.ts`, `flight-form.tsx`,
  `recipient-picker.tsx`.
- `lib/flights/recipients.ts`, `recipient-query.ts`, `mutation.ts`, `form-state.ts`.
- `tests/flight-recipients.unit.mts`, `flight-form.unit.mts`,
  `tests/helpers/flight-create-cases.mjs`.
- This verification document.

## Review handoff

No founder decisions block the approved scope. Full historical tests, combined Auth
suite and hosted Netlify preview verification were not run locally under the focused
test policy. Normal CI consumes these same extended checks. Preview verification
remains separate from production release verification. No hosted Supabase data,
accounts or settings were changed, and no production release was requested.
Unrelated AGENTS.md and docs/audits changes are excluded.
