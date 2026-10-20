# VOLO-173 — Flight schema verification

Branch: `feature/volo-173-flight-schema`, based on `591f54a`.
The user approved the schema design and native implementation plan in chat.

## Implemented

- Additive migration `20261020020000_create_flights.sql` creates flights and
  PRIVATE recipients, ownership/identity foreign keys, indexes, timestamps,
  NETWORK/PRIVATE visibility and open/cancelled/completed lifecycle values.
- Enforces required flight data, positive joining-pilot capacity, normalized
  airport format, same-airport flights, 500-character aircraft descriptions and
  optional 2,000-character notes. Remaining capacity is not stored separately.
- Validates named IANA departure zones or UTC and finite departure instants;
  derives the departure-local date on every write. Regional aliases are accepted;
  abbreviations, arbitrary offsets and fixed-offset Etc aliases are rejected.
  User-entered local-time ambiguity/gap conversion remains with VOLO-175.
- Owner identity is immutable. Restrictive foreign keys preserve relationships
  rather than cascading deletion. Selected recipients must be active other members
  of a PRIVATE flight. Recipient writes lock the flight so mode edits cannot race
  into a NETWORK flight with recipient rows.
- RLS and explicit grants ship with the tables. Reads require current active
  membership and the approved visibility rule; unrelated administrators get no
  PRIVATE bypass. Owners read their audience, recipients only their own eligibility.
  Narrow private-schema predicates avoid recursive RLS and are absent from public RPCs.
- Direct member writes remain disabled. No posting/recipient mutation RPC or future
  request/conversation table was added. Future guarded operations must implement
  the VOLO-172 removal, cancellation, conversation closure and history contract.
- Public database types were generated through the existing local CLI script.
  The existing upgrade verifier's migration-history lists include the new version;
  its GitHub-hosted ownership and execution guards remain unchanged.

## Evidence

All database operations used a uniquely owned disposable PostgreSQL 17 Supabase
stack created with the existing `tests/helpers/local-auth-stack.mjs` helper.
No hosted database, provider email, production account or developer database was used.

| Check | Result |
| --- | --- |
| Initial tables-exist tests before implementation | Expected failure: both flight tables absent |
| Flight integrity and read/write authorization | 82 pgTAP assertions passed |
| Current membership boundary | 14 existing pgTAP assertions passed |
| Seedless full migration replay, then focused tests | 96 assertions passed |
| Same rebuilt database with repository fictional seeds loaded | 96 assertions passed |
| Upgrade from previous migration head | New migration applied; hashes of existing fictional Auth, membership and profile rows unchanged |
| CLI-generated public types and drift check | Passed |
| Next route type generation and TypeScript `--noEmit` | Passed with offline public CI environment fixtures |
| Independent whole-change code review | No actionable findings |

SQL coverage includes field bounds, finite instants and timezone/date behavior,
immutable ownership, restrictive deletion, recipient validation/uniqueness,
NETWORK/PRIVATE reads, audience counts/joins, spoofed metadata, disabled and
unadmitted callers, unchanged-JWT revocation, reactivation/removal and member-write
bypass denial. Each test transaction rolls back its fictional fixtures.

The initial type-check attempt could not run through npm because npm is absent
from this shell. Direct execution of the same Next/TypeScript tools initially
reported missing environment configuration; it passed after supplying the offline
CI fixtures. Neither condition required application code changes.

The full application/database suite, real HTTP flight surfaces and GitHub-only
historical invitation upgrade/concurrency verifier were not run locally. CI keeps
its existing broader checks; VOLO-174 owns further direct-data-API policy review.
Netlify preview verification and production migration/release verification remain
separate and have not been performed for this ticket.

## Files and handoff

New: migration, `supabase/tests/database/flights.test.sql`, this verification note,
`docs/volo-173-schema-design.md` and the implementation plan. The existing local
`docs/volo-172-visibility-contract.md` is the approved prerequisite contract.
Modified: `lib/supabase/database.types.ts` and
`scripts/verify-invitation-upgrade.mjs`.

Unrelated existing AGENTS.md and docs/audits changes were preserved. No new founder
schema decisions remain. Material post-acceptance edits, accepted withdrawal,
request reactivation and broader account retention remain with their owning tickets.
Review this change before beginning VOLO-174; no deployment was performed.
