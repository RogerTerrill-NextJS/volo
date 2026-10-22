# VOLO-184 — Verified own-flight indicator

Approved bounded scope on `feature/volo-184-own-flight-indicator`, from reviewed
VOLO-237 / `f1db898`. The parent VOLO-53 requires clearly distinguishing posts
owned by the signed-in pilot in existing feed/detail presentation. Installed
Next.js data-security guidance was reviewed before changes.

## Implementation

- Feed and detail query DTOs include a presentation-only `isOwn` boolean, computed
  from the normalized stored owner ID and the final verified current member ID.
  Computation occurs after the existing fresh membership and identity rechecks.
  No new database field, query, access grant or shared cache is introduced.
- Raw row ownership flags/metadata are ignored. Admins receive the same comparison
  as other members; being able to read a flight does not imply owning it.
- Existing feed cards and detail headers show a visible, high-contrast “Your flight”
  text badge only for owned posts. It sits beside existing visibility/status text,
  wraps on narrow screens and does not rely on color or icons alone.
- No edit/request action or eligibility rule is added. Existing RLS, minimal public
  projections, unavailable states, cursor pagination and protected responses remain.

## Verification

| Check | Result |
| --- | --- |
| Relevant pre-change feed/detail baseline | 11 passed |
| Ownership/projection tests before query changes | Expected failures: missing derived flag |
| Focused feed/detail/view units | 16 passed |
| Rendered-page test before badge implementation | Expected failure: own card lacked text indicator |
| Next route type generation / TypeScript / repository-wide ESLint / diff checks | Passed |
| Independent read-only review | No actionable findings |
| Compiled real-session feed/detail integration | 9 scenarios passed |
| Browser presentation | Owner/non-owner feed/detail, desktop and 390px mobile passed |

Two focused query cases cover actual owner and other-member identities for both
member/admin roles, with forged ownership flags and row metadata. Existing
revocation/switched-identity tests ensure rejected reads do not expose a DTO.
Projection expectations now allow only the added boolean alongside the existing
public fields; pagination and validation regressions remain covered.

One scenario extends the existing disposable real-Auth/app fixture. It checks
both member and admin feed pages contain badges on their own cards and omit them
on visible other-owner cards, then checks each corresponding detail page. It
uses real permitted PRIVATE and NETWORK records and existing cleanup. No cosmetic
snapshot suite, new harness or repeated standalone authorization matrix is added.

Browser QA confirmed one badge on the viewer-owned NETWORK card, none on the
other pilot’s NETWORK/selected-PRIVATE cards, and the corresponding detail pages.
The text badge remained legible in the existing dark theme; the mobile detail
document and viewport both measured 390px with no horizontal overflow.

## Modified files

- `lib/flights/feed-query.ts`, `lib/flights/detail-query.ts`.
- `app/(protected)/dashboard/flights/flight-card.tsx`.
- `app/(protected)/dashboard/flights/[flightId]/flight-details.tsx`.
- `tests/flight-feed.unit.mts`, `tests/flight-detail.unit.mts`,
  `tests/helpers/flight-feed-cases.mjs` and this document.

No schema, RLS, dependencies, hosted Supabase data/accounts/email/settings or
production publication changes. Full historical/combined Auth suites and hosted
preview/release verification are separate from local targeted evidence. No founder
decision remains for this scope. Unrelated `AGENTS.md` and `docs/audits/` changes
are preserved and excluded.
