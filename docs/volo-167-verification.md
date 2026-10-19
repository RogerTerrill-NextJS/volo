# VOLO-167 — Responsive pilot directory

Implemented on `feature/volo-167-directory-ui`, based on merged VOLO-166.

## Approved scope and behavior

The founder approved the UI design and explicitly deferred profile-detail links
until VOLO-168 supplies their destination. Directory cards intentionally have
no dead or placeholder profile links. VOLO-168 has not been started.

- `/directory` appears in the existing app navigation.
- Cards show existing member-visible fields and reuse the protected photo
  component, including its initials fallback. Optional blank fields are omitted.
- Layout uses one column on mobile and two from the existing small breakpoint.
  Long names and profile text wrap inside the card.
- The server consumes `listDirectoryProfiles`, retaining its active-member
  checks, projection and cursor pagination. It shows up to twenty pilots per
  page, Next page when a cursor exists, and Back to first page on later pages.
- The page handles initial emptiness, an empty later page, malformed or repeated
  cursors, temporary query failures and unexpected rendering errors. Retry after
  a query failure preserves a valid cursor; unexpected errors reload the page
  through the access guard without rendering error details.
- A Suspense fallback displays loading text and inert card placeholders only
  after the initial page access check. Anonymous HTML requests retain the normal
  login redirect before streaming starts. The directory query independently
  rechecks access before returning any cards.
- `/directory` and its descendants use the existing private browser/CDN cache
  policy for HTML and RSC, including requests without cookies. Links do not
  prefetch private pages.
- No search, filters, database changes, dependencies, or profile editing were
  added. Existing query eligibility and visibility rules remain unchanged.

## Verification

- Test-first checks failed on the absent directory route and missing private
  route classification before implementation.
- Seven focused query/cache unit tests passed.
- Three compiled Next.js integration checks passed: the new directory page,
  existing directory query and existing protected profile-photo read.
- Directory page coverage includes member/admin access, viewers without
  profiles, disabled/unadmitted/anonymous denial, escaped profile values, no
  private-field or lookahead-row leakage, cursor navigation, first/later empty
  pages, invalid/repeated cursor handling, query failure, loading fallback,
  photo/fallback wiring, and authenticated/denied direct RSC requests.
- Type generation, TypeScript checking, focused ESLint and diff checks passed.
- Independent read-only code review found no actionable issues.
- Visual QA used the real compiled directory HTML and CSS with fictional pilot
  data. Desktop and 375px screenshots were inspected. Width checks at 320px,
  375px and 640px found no horizontal overflow; 640px rendered two columns.
  Preview assets: `/private/tmp/volo-167-desktop.png` and
  `/private/tmp/volo-167-mobile.png`. Temporary viewport overrides were reset.
- The existing private-cache HTTP regression passed: HTML/RSC/prefetch/JSON
  isolation, fresh revocation/outages, public-cache and unsafe-replay controls,
  and dynamic/static boundaries. The owned visual-preview fixture was stopped.

The full suite, Netlify Deploy Preview verification and production release
verification have not been run for VOLO-167. No hosted Supabase data/settings or
production publishing were changed. VOLO-166's database migration still requires
the separately authorized hosted release workflow; merging an application PR
does not apply it. A backend missing that RPC returns the recoverable directory
unavailable state.

## Files

- `app/(protected)/directory/page.tsx`: guarded directory, states and navigation.
- `app/(protected)/directory/pilot-card.tsx`: responsive public-profile card.
- `app/(protected)/directory/error.tsx`: safe unexpected-error fallback.
- `app/(protected)/_components/app-shell.tsx`: directory navigation link.
- `lib/http/protected-path.ts`: directory private-cache coverage.
- `tests/directory-page.test.mjs`: compiled page regression with existing fixtures.
- `tests/private-response.unit.mts`: directory cache-path boundary coverage.
- `docs/volo-167-verification.md`: approved scope and verification handoff.

Preexisting modified `AGENTS.md` and untracked `docs/audits/` are left untouched.
