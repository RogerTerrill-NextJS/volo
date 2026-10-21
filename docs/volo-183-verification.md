# VOLO-183 — Authorized flight detail and pilot context

Approved bounded scope on `feature/volo-183-flight-detail`, based on merged
VOLO-182 (`280ba95`). The user approved implementation and pull-request creation.
Installed Next.js dynamic-route and notFound guides were reviewed.

## Implemented behavior

- `/dashboard/flights/[flightId]` reads a single permitted flight through the
  ordinary user-session client and existing flight RLS. Feed route headings link
  to the detail page with protected-data prefetch disabled.
- The server-only query validates UUIDs before database reads, explicitly selects
  and projects the permitted flight fields, and sanitizes provider failures.
  No recipient list, account email, membership record or privileged metadata is
  selected. Admins receive no unrelated PRIVATE-flight bypass.
- Fresh access checks surround the flight read and optional pilot lookup. Changed
  viewers or revoked membership discard the result. Absent and RLS-inaccessible
  flights share the same not-found outcome; they never cause a pilot lookup.
- Posting-pilot context reuses `getNetworkProfile`, including its public profile
  projection and current eligibility rules. Missing/ineligible or temporarily
  unavailable profiles produce neutral fallback text while preserving a permitted
  flight. Authentication/authorization failures still discard the result.
- The responsive detail article shows route, departure-local date/time, named zone
  and UTC offset, aircraft, configured joining-pilot capacity excluding the owner,
  visibility, stored lifecycle status, and plain-text multiline notes. No remaining
  availability or full flag is inferred. The original microsecond instant is kept
  in the time element; display formatting reuses the existing feed adapter.
- Detail reads are independent of upcoming-feed filters: existing RLS determines
  whether past, cancelled or completed records may be read by ID. No lifecycle or
  history entitlement is added. Later expired/cancelled presentation belongs to
  its owning ticket.
- Optional owner/joiner action slots are empty. No request/edit rules, inert action
  buttons or new database fields are introduced. Existing private response headers
  and protected-navigation behavior cover the nested route.

## Verification

| Check | Result |
| --- | --- |
| Pre-change feed/time/public-profile units | 19 passed |
| New detail-query tests against initial stub | 5 expected failures |
| New rendered detail scenario before page implementation | Expected failure; existing 4 query scenarios passed |
| Relevant detail/feed/time/public-profile units | 24 passed |
| Compiled real-session flight integration | 8 scenarios passed |
| Next route type generation, TypeScript, focused ESLint | Passed |
| Independent read-only code review | No actionable findings |
| Supabase import/browser/HTTP boundaries | Passed |
| Local browser checks | Mobile 390 × 844 and desktop 1728px passed |

The new units protect early access/ID rejection, minimum public projection,
malformed/mismatched records, preserved notes, lifecycle-independent reads, optional
pilot failures, access revocation and changed viewer identity. One first green
attempt exposed an undefined fixture falling through its test helper's default;
the test now supplies that malformed response explicitly.

Two detail scenarios extend the existing disposable Auth/app fixture without a new
harness. They cover selected PRIVATE access, unrelated viewers and ordinary admins,
anonymous/disabled access, random/invalid IDs, HTML/RSC exclusion, local time/offset,
notes escaping, profile fallback for a disabled owner, stored statuses, recipient
removal, access revocation during reads, provider outage, and real feed detail links.
Existing feed filtering, stable pagination, error and retry checks also passed.

Browser QA verified keyboard activation of a selected PRIVATE feed link, local
departure/offset rendering, multiline notes displayed as literal text, public pilot
context, safe invalid-ID recovery, outage feedback and retry. Long unbroken aircraft
text wraps without horizontal overflow at 390px and 1728px. The boundary check
initially could not bind its loopback HTTP server in the sandbox; its authorized
rerun completed successfully.

## Modified files

- `lib/flights/detail-query.ts`.
- `app/(protected)/dashboard/flights/[flightId]/page.tsx`, `flight-details.tsx`,
  `not-found.tsx`, `error.tsx`.
- `app/(protected)/dashboard/flights/flight-card.tsx`, `page.tsx`, `new/page.tsx`.
- `tests/flight-detail.unit.mts`, `tests/helpers/flight-feed-cases.mjs`.
- `package.json` and this document.

No schema/RLS changes, dependencies, hosted Supabase data/accounts/email/settings
writes, merge, or production publication. The full historical/combined Auth suites
are left to CI under the focused-test policy. Hosted Netlify preview verification
and production release verification remain separate and have not been performed.
No founder decision remains for this approved scope. Unrelated `AGENTS.md` and
`docs/audits/` changes are excluded.

## CI lint correction

The first PR validation run failed at lint, before build/tests. Adding the dynamic
flight detail route made Next.js's internal-route lint rule flag two existing native
links in the feed and creation pages. Focused lint reproduced both errors locally.
These links intentionally perform document navigation: Clear filters discards
unapplied drafts even on the unfiltered URL, and creation retry performs a fresh
profile check. They retain that behavior with documented, single-line lint
exceptions; the global rule remains enabled. No runtime behavior or tests changed.

After the correction, repository-wide ESLint, TypeScript and diff checks passed.
The change adds only comments and formatting; existing reload behavior is preserved.
