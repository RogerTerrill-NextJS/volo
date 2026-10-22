# VOLO-187 — Mobile flight and keyboard polish

Approved bounded work on `feature/volo-187-mobile-flight-polish`, based on reviewed
VOLO-186 / `4ac5b5f`. Parent VOLO-55 calls for a short manual responsive/keyboard
pass on the existing flight feed and detail screens. The installed Next.js
accessibility, linking/navigation and Form guides were reviewed.

## Concrete findings and changes

- App navigation links and Sign out measured only 20px high on the 390px feed.
  They now share a 44px minimum height, padded hit area and visible focus outline.
  Wrapped rows use smaller vertical gaps to retain a compact mobile header. The
  same sizing/wrapping is applied to the shared access-state recovery links.
- Native date-picker icons were nearly black against the dark filter inputs.
  Feed inputs now declare light/dark native control schemes. In the reviewed dark
  theme the computed date-input scheme is `dark`, with visible white calendar
  icons. Existing input types, values and native date-picker behavior are retained.
- Keyboard submission of an invalid airport left the error summary below the
  mobile viewport (top 1185px at 320×740), with focus on the document and no alert.
  The existing named invalid-filter summary now has `role="alert"`, consistent
  with the feed's provider-error state. The accessibility tree exposes the alert;
  no new focus controller or client component was added.

The existing detail and card wrapping already handled eight-character airport
codes and a 500-character aircraft description at 320px. Those layouts and flight
data behavior did not need changes. Shared navigation destinations, prefetch
settings, native Clear filters/retry navigations and POST sign-out remain intact.

## Manual review evidence

Reused the existing owned local Supabase/real-Auth/compiled Next browser fixture,
including production CSS. Only fictional accounts and flights were created. The
fixture was extended locally with enough upcoming flights to exercise pagination;
no committed harness or framework was added.

| Reviewed screen/flow | Result |
| --- | --- |
| 320px detail with long route/aircraft, 390px feed/detail, 1280px desktop detail | No horizontal overflow; document width equaled viewport width |
| App navigation and Sign out at 320px | All six controls 44px high; sequential Tab focus showed a 2px solid outline |
| Detail back link activated with Tab/Enter | Returned to upcoming feed |
| Dark feed native dates and filter controls | Date inputs 44px high; white picker icons and visible focus |
| Invalid filter submitted by keyboard | Named error alert present in accessibility tree |
| Pagination activated with Enter | 20 cards on first page, 2 on continuation; Back to first page worked |
| Empty filter and Clear filters | Empty state rendered; clearing restored feed; clearing unapplied drafts also reset inputs |
| Feed/detail outage and keyboard retry | Safe error states; retry links 44px high; recovery restored flight content |
| PRIVATE cancelled detail and notes | Local date/time, `America/Los_Angeles`, UTC offset, lifecycle notice and plain-text notes readable |
| Completed and owner past details on desktop | Correct notices and Your flight indicator retained |
| Missing detail and keyboard recovery | Safe missing state; back link returned to feed |
| Disabled viewer at 390px | Access-denied screen fit; Back to home was 44px high with keyboard focus; membership restored afterward |
| Keyboard Sign out | Native POST returned to signed-out login feedback |

The local browser used the existing dark theme. Browser viewport checks are not
physical iPhone/Safari or screen-reader certification. Alert semantics were checked
in the accessibility tree, not through a separate screen-reader session.

## Validation and scope

- Compiled production-CSS browser fixture built successfully with final changes.
- Next route type generation, TypeScript, repository-wide ESLint and diff checks:
  passed.
- Independent read-only review, including the final alert change: no actionable
  findings.
- Owned browser tabs, app, fictional data/accounts and local database were cleaned
  up successfully; the temporary viewport override was reset.
- No new automated/snapshot tests or full test suite: this ticket explicitly uses
  a short manual pass, and the changes concern hit areas, native-control appearance
  and existing error semantics. Existing Auth/query/RLS behavior is unchanged.

Changed application files are `app/(protected)/_components/app-shell.tsx`,
`app/(protected)/_components/access-state.tsx` and
`app/(protected)/dashboard/flights/page.tsx`, plus this note. No schema, RLS,
dependencies, hosted Supabase data/accounts/email/settings, merge or production
publication changes. No founder decisions remain for this scope. Netlify preview
and production verification remain separate from the local evidence. Unrelated
`AGENTS.md` and `docs/audits/` work is preserved and excluded.
