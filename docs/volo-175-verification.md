# VOLO-175 — Shared flight input and timezone validation

Branch: `feature/volo-175-flight-validation`, based on merged VOLO-174 (`cf97f26`).
The user approved the bounded design and DST behavior in chat: reject nonexistent
local times; require an explicit earlier/later choice for repeated local times.
No new database field is needed for that choice.

## Implemented interfaces

- `lib/validation/airport.ts`: `normalizeAirportIdentifier(unknown)` returns a
  trimmed uppercase 2–8 character alphanumeric identifier or null. Both flight
  and existing profile validation reuse it. This is format normalization, not
  verified airport lookup; identical departure/destination identifiers are valid.
- `lib/flights/time.ts`: `resolveDeparture({localDate, localTime, timeZone,
  occurrence?})` returns a validated UTC `departure_at`, canonical named
  `departure_timezone` and `departure_local_date`, or a safe error code.
  Dates require a real YYYY-MM-DD calendar date, years 0001–9999; times require
  HH:MM or HH:MM:SS. Named IANA zones and UTC follow the schema's regional-zone
  semantics; abbreviations, arbitrary offsets and Etc/posix/right aliases fail.
- Repeated times return `ambiguous_time` until `occurrence` is `earlier` or `later`.
  Nonexistent times return `nonexistent_time` even with an occurrence choice.
  Offset candidates come from the surrounding IANA regimes and must round-trip
  exactly to the submitted wall clock. No host/viewer zone or silent Date-parser
  DST adjustment is used. No one-hour-transition assumption or dependency added.
- `formatDeparture(instant, zone)` returns departure-local date/time, canonical
  zone, UTC offset, explicit label and the repeat occurrence needed to round-trip
  an edit. It rejects invalid inputs rather than displaying misleading values.
  Input operates at second precision; nonzero stored sub-seconds return null
  rather than being silently truncated. Millisecond-zero ISO storage forms work.
- `lib/flights/validation.ts`: `validateFlight(unknown)` returns an allowlisted
  database-content payload or static field errors, following profile conventions.
  Allowed input fields are departure/destination airport, departure-local date/time,
  departure zone/occurrence, aircraft description, pilot places, notes and visibility.
  Output contains UTC departure and normalized storage fields; the occurrence
  selector and local clock input are not database fields.
- Required aircraft descriptions are trimmed and bounded at 500 Unicode code
  points; optional trimmed notes are null when cleared and bounded at 2,000.
  Capacity is an integer from 1 through PostgreSQL's integer maximum, excluding
  the owner, never a mutable remaining-place counter. Native decimal digit strings
  and numeric integers share validation. Existing NETWORK/PRIVATE values are
  validated; GROUP is rejected.
- Protected/derived/unexpected inputs, including owner/id/status/timestamps,
  raw departure_at and recipient arrays, are rejected. Non-plain objects are
  rejected; errors never echo the submitted values.
- `lib/flights/ownership.ts`: server-only `canEditFlight(access, storedFlight)`
  requires an authorized current-access result and matching stored owner, with
  no unrelated-admin bypass. Missing resources and every access-failure state deny.

## Server wiring and scope

`validateFlight` validates complete content for create/edit; it is not PATCH merging,
identity verification or an authorization grant. Server callers must use the
existing `runMutation`/`getAccess` boundaries and load the immutable flight owner
from the database before calling `canEditFlight`. Posting/requesting retain their
existing completed-profile gate. Never pass form/JWT claims as trusted owner/access
state. Origin checks, current membership and RLS remain mandatory.

The helpers convert valid calendar instants without imposing new edit lifecycle
rules. The upcoming-flight create operation in VOLO-176 must apply its server-time
future-departure requirement; validation alone does not permit posting past flights.
Creation, actual edit endpoints, recipient selection, capacity/state transitions and
UI belong to their owning tickets. Browser feedback may reuse the pure helpers,
but the server must independently validate authoritative input and timezone data.

## Evidence

| Check | Result |
| --- | --- |
| New tests against initial stubs | Expected behavior failures before implementation |
| Flight time/input/ownership plus existing profile validation | 17 tests passed |
| Existing compiled profile-save authorization regression | 1 test passed; owned fixture cleaned up |
| Next route type generation and TypeScript `--noEmit` | Passed with offline public CI fixtures |
| Focused ESLint and whitespace checks | Passed |
| Independent review | No actionable findings; independently passed 17 tests and 2,508 timezone roundtrips across Intl-supported zones and years 0001–9999 |

Focused command: `npm run test:flights:unit`. The existing CI validation job runs it
with `--conditions=react-server`, matching the server-only ownership helper.
The suite covers UTC/local date boundaries, different viewer zones, spring gaps,
autumn repeats, explicit choices, half-hour DST, non-hour offsets, a skipped day,
invalid calendar rollover, clock/zone inputs, display/edit roundtrips, Unicode text
bounds, integer capacity, same-airport flights, protected fields and owner-only access.

No full suite or unrelated Supabase integration matrix was rerun locally. No schema,
generated types, database records, hosted settings, email or deployment changed.
No production or Netlify preview verification was performed for this ticket.

## Files and handoff

New: `lib/flights/time.ts`, `lib/flights/validation.ts`,
`lib/flights/ownership.ts`, `lib/validation/airport.ts`,
`tests/flight-time.unit.mts`, `tests/flight-validation.unit.mts` and this note.
Modified: `lib/profiles/validation.ts`, `package.json`, `.github/workflows/ci.yml`.
Unrelated existing AGENTS.md and docs/audits changes were preserved.

No new founder decision blocks this ticket. Review VOLO-175 before starting
VOLO-176. Material post-acceptance edits and other unresolved lifecycle decisions
remain with their owning tickets; no such behavior was introduced here.
