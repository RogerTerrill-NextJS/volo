# VOLO-182 — Responsive upcoming-flight feed

Approved bounded scope on `feature/volo-182-responsive-flight-feed`, from merged
VOLO-181 (`4bd0f7e`). The user approved implementation and PR creation. Installed
Next.js page/searchParams, Form, loading and Link guides were reviewed.

## Implemented behavior

- `/dashboard/flights` uses the existing protected shell/page gate and VOLO-181
  query. App navigation exposes Upcoming flights. Existing `/dashboard/` private
  response and restored-navigation protections apply; no new cache exception.
- Responsive cards show route, departure-local date/time, named zone and UTC offset,
  aircraft, configured joining-pilot capacity excluding the owner, and NETWORK or
  PRIVATE visibility. Labels explain capacity without claiming remaining availability.
- GET filters combine exact normalized departure/destination airports and inclusive
  departure-local date bounds. Applying filters starts at page one. Next and first
  page links preserve all applied criteria. Duplicate values remain invalid rather
  than silently choosing one. Unknown URL fields are not reflected into filter state.
- The native filter inputs remount when applied query/page state changes, so unapplied edits
  cannot mislabel paginated results. Clear filters performs a normal navigation,
  resetting drafts even when the URL is already unfiltered. GET forms/links work
  without JavaScript. Protected navigation does not prefetch member data.
- Suspense supplies an announced loading state. Empty results distinguish initial,
  filtered and exhausted pages. Invalid filters/page links offer recovery; temporary
  query failure retains a retry link. Unexpected errors render static safe feedback.
- The display-only timestamp adapter reuses existing timezone/offset formatting at
  second precision. Original six-digit instants stay in `<time datetime>` and the
  query cursor. Existing editing validation continues to reject truncated fractions.
- Criteria normalization is exported from the existing query rather than duplicated.
  No RLS, schema, authorization, visibility or query-pagination semantics changed.

## Approved handoffs

Detail links activate with VOLO-183 when its authorized detail route exists. The
user explicitly approved this handoff; no broken link or placeholder detail route
is introduced here. VOLO-183 is not started by this ticket.

The approved full-flight presentation remains visible with a future Full label.
Accepted-request capacity is not implemented, so this UI does not invent availability
or a full flag. Moderation-hidden fields remain absent; their owning feature must
integrate actual exclusion before exposing hiding. Existing PRIVATE RLS applies now.

## Verification

| Check | Result |
| --- | --- |
| Pre-change feed/time baseline | 13 passed |
| New view/navigation behavior tests before implementation | Expected failures |
| Focused flight/profile/recipient/directory units | 45 passed |
| Existing creation/recipient/query integration | 22 scenarios passed before the new UI assertion |
| Focused compiled feed integration | 6 scenarios passed on final implementation |
| Next route type generation / TypeScript / focused ESLint | Passed |
| Independent read-only review | No actionable findings after corrections |
| Final local browser checks | Mobile 390 × 844 and desktop 1728px passed |

The new pure cases cover normalized filter links, cursor reset, repeated/malformed
input, bounded form recovery, departure-local dates, repeated DST times/offsets and
microsecond display without weakening edit validation. Existing timezone/query/RLS
checks are reused instead of copied.

Two rendered-page scenarios extend the existing owned Auth/app fixture: actual
20+1 paging links with combined filters, local time/zone/capacity labels, PRIVATE
exclusion in HTML and RSC, anonymous/disabled access, empty/invalid states and error
recovery. A feed-only switch on the existing runner reuses its actors, app and cleanup
to run these six related feed scenarios without repeating unrelated creation cases.
Normal CI still exercises the combined flight integration path.

Initial browser QA reproduced unapplied filter drafts surviving Clear and Next page.
The native-input-key/native-clear correction above addresses that behavior. A whole
Next.js Form key change was rejected after browser QA found a retained duplicate
form; the Form itself now stays stable. The first UI
integration run failed on an adjacent-text HTML assertion; page assertions normalize
React comment separators while preserving the same visible-text expectations.

Final browser QA verified keyboard filter submission from page two resets the cursor;
20+1 filtered pagination retains all criteria; unapplied drafts reset; Clear removes
drafts on an already-unfiltered URL; one Form remains throughout. The selected
PRIVATE card is visible while the unselected canary remains absent. Delayed reads
show Loading, an outage shows static safe feedback, and retry recovers with filters
retained. Empty and invalid-filter states were checked. Mobile document width was
390px; desktop used two 460px columns with document width 1728px. No horizontal
overflow occurred, including the long-aircraft-description fixture.

## Modified files

- `app/(protected)/dashboard/flights/page.tsx`, `flight-card.tsx`, `error.tsx`.
- `app/(protected)/_components/app-shell.tsx`.
- `lib/flights/feed-view.ts`, `feed-query.ts`.
- `tests/flight-feed-view.unit.mts`, `tests/helpers/flight-feed-cases.mjs`,
  `tests/helpers/flight-create-cases.mjs`, `tests/helpers/real-auth-app.mjs`.
- `scripts/verify-auth-integration.mjs`, `package.json`, this document.

No new dependency, production migration, hosted Supabase data/accounts/email/settings
change or production publication. Full historical/combined Auth suites and hosted
Netlify preview checks were not run locally under the focused-test policy. Preview
verification remains separate from production release verification. No founder
approval remains for this scope; detail/capacity/moderation handoffs are explicit.
Unrelated AGENTS.md and docs/audits changes are excluded.
