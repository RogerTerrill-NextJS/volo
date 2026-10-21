# VOLO-181 — Eligible upcoming-flight query

Approved bounded implementation on `feature/volo-181-upcoming-flight-query`, based
on merged VOLO-180 (`8a1125c`). The user approved the proposed design, the full-flight
presentation decision below, and PR creation. VOLO-59 is Done and its PRs are merged.
The installed Next.js data-security and fetching-data guides were reviewed.

## Implemented query

`listUpcomingFlights(input)` in `lib/flights/feed-query.ts` is server-only. It uses
fresh authentication/membership checks before and after a session-authenticated
read, rejects a changed viewer, and preserves existing flight RLS. NETWORK records
and only permitted PRIVATE records are returned; ordinary admins get no bypass.
No identity, membership grant, visibility override or audience is accepted as input.

Inputs are optional `departureAirport`, `destinationAirport`, `dateFrom`, `dateTo`,
`after` and `pageSize`. Blank filters are omitted. Airports reuse exact uppercase
identifier normalization; dates are valid ISO calendar dates and bounds are
inclusive. Filtering uses the stored database-derived departure-local date, never
UTC or the viewer's timezone. Invalid fields, reversed dates, malformed cursors
and page sizes outside 1–50 return `invalid` before any flight-data read.

Rows must be open and depart strictly after the current server instant. Results
sort by `(departure_at, id)` ascending. Pages default to 20, fetch one extra row to
determine continuation, and have no total count. The cursor preserves all six
PostgreSQL fractional digits and binds the normalized filters. A cursor is only a
seek position, carries no authorization and does not require its reference row to
remain present. The current time and current access are checked on every page.
Changing filters requires resetting the cursor; page size can change independently.

The explicit projection contains flight/owner UUIDs, airports, departure instant,
timezone/local date, aircraft description, configured `pilot_places`, and visibility.
It omits notes, private account data, recipient lists, internal timestamps and
privileged metadata. Malformed/out-of-order/unexpected results fail closed without
returning partial rows or raw errors. The read reuses the existing five-second
session request/body deadline, read-only cookies, no-store transport, redirect denial
and disabled automatic retry. No shared query cache or new production route exists.

## Approved decisions and integration handoffs

- Full flights remain in the feed and will be marked Full when accepted-request
  capacity tracking exists. This query does not filter by capacity. Requests are
  not implemented yet, so it returns configured capacity only, never a fabricated
  remaining count or full flag. The owning request/capacity work must add the derived
  value without exposing request identities or changing this presentation decision.
- Moderation-hidden fields and operations do not exist in the current approved
  schema. Current unauthorized PRIVATE records are excluded by RLS. The moderation
  feature must enforce its hidden-record rule in the actual read boundary/RLS and
  extend feed checks before hiding becomes available. No speculative field or
  alternate hidden-status vocabulary is introduced here.
- VOLO-182 owns responsive feed/filter/loading/error/empty UI and must use private
  response headers and the existing protected page boundary. It is not started here.
- Keyset pagination is not a historical snapshot: edits to departure times or access
  can change later pages. Revocations apply freshly, and removed/past flights disappear.

## Verification

| Check | Result |
| --- | --- |
| Relevant pre-change baseline | 15 passed |
| Query behavior tests before implementation | Expected failures against unavailable-only stub |
| Null-airport projection regression before fix | Expected failure; then passed |
| Focused flight/profile/recipient/directory units | 42 passed |
| Compiled real Auth integration | 22 scenarios passed |
| Next route types / TypeScript / focused ESLint | Passed |
| Independent read-only review | No actionable findings |

The first integration run failed during mixed-status fixture setup: omitted fields
in a bulk insert defaulted to null, conflicting with required flight status. The
fixture now requests database defaults (`defaultToNull: false`); the repeated run
passed all 22 scenarios. No production behavior was changed for this fixture fix.

The six query unit cases cover access denial/revocation/identity changes, normalized
and invalid filters, bounded pagination, microseconds/ties/cursor boundaries, filter
binding, safe projection, corrupt rows, time/terminal exclusions, local dates,
provider failure and current-time advancement across pages.

Integration extends the existing creation fixture/actors with focused feed cases;
there is no duplicate harness or copy of the full flight RLS matrix. It exercises
this production query through the compiled app and real session data API, including
selected/owner/unrelated visibility, exact DTO shape, combined filters across pages,
local dates crossing UTC boundaries, exclusion of terminal/past flights, empty
results, deleted cursor reference rows, live revocation and provider errors.

## Modified files

- `lib/flights/feed-query.ts`.
- `tests/flight-feed.unit.mts`, `tests/helpers/flight-feed-cases.mjs`.
- `tests/helpers/flight-create-cases.mjs`, `tests/helpers/real-auth-app.mjs`.
- `package.json` includes the query units in the existing flight test command.
- This verification document.

No schema, RLS, generated database types or dependencies changed. No founder
approval remains for this scope; capacity and moderation integrations above remain
explicit future work. Full historical/combined Auth suites and hosted preview checks
were not run locally under the focused-test policy. No hosted Supabase data,
accounts, email, settings or production publication was changed. Netlify preview
and production release verification remain separate. Unrelated AGENTS.md and
docs/audits changes are excluded.
