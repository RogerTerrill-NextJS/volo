# VOLO-185 — Past and cancelled flight presentation

Approved bounded implementation and PR creation on
`feature/volo-185-flight-lifecycle-presentation`, based on reviewed VOLO-184 /
`7fc9d03`. Parent VOLO-54 requires hiding or visually separating past/cancelled
posts. Installed Next.js data-security guidance was reviewed before changes.

## Behavior

- Existing upcoming-feed eligibility remains unchanged: stored status must be
  `open` and departure must be strictly later than the query's current instant.
  Past, cancelled and completed records stay outside default upcoming results.
- Authorized detail DTOs add a presentation-only `isPast` flag. It compares the
  normalized stored departure instant with a fresh server clock after reads and
  access checks. Server milliseconds are padded to PostgreSQL microsecond precision;
  stored departures are not rounded. At the exact departure instant the flight is
  no longer upcoming; a departure one microsecond later remains upcoming.
- Open records whose departure has elapsed show “Past departure” in the header
  and a named notice explaining they are no longer upcoming. Cancelled/completed
  records receive their corresponding notice regardless of departure time. Stored
  cancellation/completion takes precedence over the elapsed-departure label.
- Stored status is preserved. No automatic status mutation, cancellation action,
  archive view or new history entitlement is introduced. Direct details retain
  existing current-membership and NETWORK/PRIVATE RLS requirements; ordinary admins
  gain no bypass. Existing own-flight and public pilot context remain available.
- Notices use headings and plain text, not color alone. State is evaluated on a
  fresh server read; an already-open page does not acquire a new timer or polling.

## Verification

| Check | Result |
| --- | --- |
| Pre-change feed/detail/time baseline | 20 passed |
| New precise-clock/detail projection tests before implementation | Expected failures |
| Focused detail/feed/time/view units | 25 passed |
| Existing rendered lifecycle case before notices | Expected failure |
| Final compiled real-session feed/detail integration | 9 scenarios passed |
| Next route types, TypeScript, repository-wide ESLint, diff checks | Passed |
| Independent read-only review | No actionable findings |
| Local real-Auth browser checks | Default feed separation and past/cancelled/completed details passed |

Two query regressions cover earlier/equal/one-microsecond-later instants, immutable
stored status/precision, fresh time on repeated reads and after a profile lookup,
ignored supplied flags, and invalid clocks failing closed. Existing access,
identity-switch, query-pagination and timezone validation checks are reused.

The existing disposable integration lifecycle scenario now verifies accessible
notices, no historical notice on an upcoming open detail, default-feed exclusions,
and a past cancelled PRIVATE record retaining its cancellation notice for the
owner while an unrelated admin receives the same safe missing state. No live
cancellation action or new test harness is needed. The final run includes the
explicit assertion that an elapsed open record is not labeled Open in the header.

Browser QA used the existing owned local Supabase/app fixture: only the future
open flight appeared in the feed; selected PRIVATE cancelled, NETWORK completed
and owner past details remained accessible through their permitted direct links.
The past notice, own-flight badge and departure timezone were legible at 390px;
document width equaled viewport width. Desktop notices were checked in the existing
dark theme. All fictional data/accounts are cleaned up by the owned fixture.

## Files and limits

- `lib/flights/detail-query.ts`.
- `app/(protected)/dashboard/flights/[flightId]/flight-details.tsx`.
- `tests/flight-detail.unit.mts`, `tests/helpers/flight-feed-cases.mjs`.
- This verification note.

Full historical/combined Auth suites and hosted preview/release verification are
separate from targeted local evidence. No database/schema/RLS change, dependency,
hosted Supabase data/accounts/email/settings write, merge or production publication.
No founder decisions remain for the approved scope. Unrelated `AGENTS.md` and
`docs/audits/` changes are preserved and excluded.
