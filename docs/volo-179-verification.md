# VOLO-179 — Authorized private-recipient selection

Branch: `feature/volo-179-private-recipients`, from merged VOLO-178 (`aabd290`).
The user approved the recommended approach and requested implementation through PR
creation. [Design](volo-179-recipient-design.md) and
[implementation plan](superpowers/plans/2026-10-21-volo-179-private-recipients.md)
record that scope. Installed Next.js security/forms guides were reviewed.

## Implemented behavior

- `create_private_flight` atomically creates an owner-derived PRIVATE flight and
  nonempty validated recipients. It reuses the existing creation/profile/time gates.
  Invalid/self/duplicate/missing/inactive/null/oversized/multidimensional selections
  roll back the flight and every recipient. Target memberships remain share-locked.
- `change_flight_recipient` verifies the current active owner under the flight lock.
  Adds validate current target membership; adds/removals are idempotent. Disabled
  targets can be removed. Ordinary admins cannot edit another pilot's audience.
  Existing direct member table writes stay closed and RLS is unchanged.
- Fixed add/remove Server Actions reuse origin/authentication/membership/input guards,
  session-loaded ownership and `canEditFlight`; SQL independently rechecks identity
  and current eligibility. Session requests/body reads share a five-second deadline,
  no-store/error-on-redirect settings and disabled automatic write retries.
- Existing creation accepts optional bounded `recipient_ids` JSON. Nonempty selection
  requires PRIVATE and uses the atomic RPC. Existing empty/absent owner-only PRIVATE
  creation stays compatible. Confirmation accurately distinguishes selected pilots
  from owner-only posting; errors never echo recipient IDs or raw database details.
- Candidate queries reuse directory cursor/search/page-size rules and current access
  checks, exclude the verified viewer and return only UUID, display name, home airport
  and photo availability. No email, membership metadata or storage paths. A filtered
  short/empty page can retain a next cursor; the future picker must follow it.

## Approved lifecycle safeguard

Only no-request removal exists now because request and conversation tables are not
implemented. Removal fails closed if either `public.flight_requests` or
`public.conversations` exists. Their owning migrations must replace this safeguard
with atomic cancellation, conversation sending closure and retained read-only history
under the VOLO-172 protocol before those features are exposed. This ticket does not
claim that pending/accepted cancellation or history retention is implemented.

No future production tables/columns were invented. Transaction-only fixture tables
prove that the safeguard refuses deletion and preserves selections. Re-adding a
recipient restores selection-based visibility only; it cannot revive absent request
or conversation state. The actual picker belongs to VOLO-180.

## Verification

| Check | Result |
| --- | --- |
| Baseline SQL before implementation | Expected missing-recipient-function assertion failure |
| Parser/change/candidate tests before implementation | Expected behavioral failures against stubs |
| Additive migration preservation | Fictional Auth/member/profile hashes unchanged |
| Recipient + creation + flight RLS + membership + profile SQL | 225 assertions passed with seeds; 225 passed without seeds |
| Focused flight/profile/recipient/directory units | 34 tests passed |
| Real Auth/compiled native/fetched actions and direct session APIs | 17 scenarios passed |
| Generated public types | Actual CLI introspection; drift check passed |
| Next type generation / TypeScript / focused ESLint / diff check | Passed |
| Independent whole-change review | No actionable findings; reviewer independently passed 8 focused tests |

The six new recipient integration scenarios reuse existing creation actors and the
owned Auth/app fixture. They verify candidate projection and self-exclusion, atomic
mixed-batch rejection, selected versus unrelated-member reads, foreign/admin/origin
and protected-field denial, native/fetched removal, idempotent add/retry, retained-JWT
revocation, disabled target removal, no selection restoration merely from membership
re-enabling, and membership changed between candidate presentation and the SQL call.

The concurrency case uses two owned local PostgreSQL sessions: the first holds the
flight lock after adding a recipient; the second is observed waiting on a lock while
removing that same recipient. Both commit and the final selection is absent. This
checks serialization rather than assuming an ordering from concurrent requests.
All eleven prior creation/form scenarios also passed.

## Modified files

- `supabase/migrations/20261021010000_private_recipients.sql` and
  `supabase/tests/database/flight_recipients.test.sql`.
- `lib/flights/recipients.ts`, `recipient-query.ts`, `recipient-mutation.ts`,
  `client.ts`, `mutation.ts`, `actions.ts`, `form-state.ts`.
- `lib/supabase/database.types.ts`, `scripts/verify-invitation-upgrade.mjs`,
  `package.json`.
- `tests/flight-recipients.unit.mts`, `tests/recipient-query.unit.mts`,
  `tests/helpers/recipient-cases.mjs`, `tests/helpers/recipient-lock-case.mjs`,
  `tests/helpers/flight-create-cases.mjs`, `tests/helpers/real-auth-app.mjs`.
- Design, plan and this verification document.

## Limits and review handoff

No additional founder product decision blocks the approved scope. The lifecycle
safeguard is an explicit technical handoff, not a changed removal rule. Candidate
presentation uses existing directory profiles; final target authorization requires
active membership and does not invent a recipient-profile-completion requirement.
No new dependency, hosted account/data/email/settings change, deployment or release.

The full historical suite, combined Auth integration and hosted Netlify preview were
not run locally under the focused-test policy. Normal CI includes the extended SQL,
unit and real Auth cases. Preview verification and production release verification
remain separate. Uncertain creation does not imply exactly-once behavior. Unrelated
AGENTS.md and docs/audits changes remain outside this ticket.
