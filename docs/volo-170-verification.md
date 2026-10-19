# VOLO-170 — Certificate, rating and aircraft directory filters

Implemented on `feature/volo-170-directory-filters` from merged VOLO-169
(`785f5c6`). VOLO-170 and parent VOLO-42 define the scope. The founder approved
text inputs over the existing free-text profile data, literal substring matching,
AND combinations, missing-value behavior, reset and pagination before implementation.

## Behavior and boundaries

- Add Certificate, Rating and Aircraft access inputs to the existing GET directory
  form. No controlled vocabulary is invented: certificates/ratings remain arrays
  of self-reported labels and aircraft access remains optional free text.
- A criterion matches a literal substring within any label of its array, or within
  aircraft text. Input and stored text are case-insensitive with surrounding and
  repeated whitespace normalized, using the existing explicit whitespace set.
  `%`, `_` and backslashes are literal, not wildcard/query syntax.
- All populated filters combine with AND, alongside name/home-airport search.
  Blank filters impose no restriction. Missing arrays or aircraft text do not
  satisfy an active filter. Each input is limited to 80 Unicode code points before
  normalization; malformed, duplicate, non-string or NUL inputs are rejected
  before a query. Browser bounds allow up to 160 UTF-16 units so supplementary
  characters can reach the 80-code-point server limit without truncation.
- Filter in the database before UUID ordering, page-size limit and lookahead.
  Preserve criteria in next/first-page/retry URLs. New submissions omit the old
  cursor. Clear search retains filters, and Reset all returns to `/directory`.
- Recoverable invalid, unavailable, no-match and exhausted-page states reuse the
  directory conventions. The responsive form stacks fields on mobile and uses
  three columns for the filters at the existing small-screen breakpoint.
- Directory cards explicitly show Not provided for missing certificates, ratings
  and aircraft access. The shared details component has an opt-in flag, leaving
  the network profile page's existing optional-field display unchanged.
- The new RPC signature defaults all new criteria to empty, retaining old callers'
  unfiltered/search-only behavior. There is only one RPC overload. Existing active
  viewer/target eligibility, profile RLS, stable invoker execution, fixed empty
  search path, authenticated-only grant and explicit public DTO remain in place.
  Existing session-only no-store transport, timeout and access rechecks are reused.

No new database fields, policies, preferences, dependencies, or external service.
No hosted Supabase data/accounts/settings or production publication changed.

## Verification

- Tests failed for unsupported filter input, missing filter controls and absent
  six-argument RPC before their respective implementation changes.
- 68 directory/network-profile SQL assertions passed with the repository's fictional
  CI seeds. All 68 passed again after a disposable reset without seeds; 46 existing
  profile and 14 membership assertions also passed in that unseeded stack.
- New SQL checks cover normalized array/text matching, AND combinations alongside
  search, cursor continuation, filtering before lookahead, missing values, blank
  filters, literal wildcard characters, input bounds, denied viewers and excluded
  disabled/unadmitted target profiles. Late-match assertions isolate their own
  UUID fixture range to avoid the seed collision corrected in VOLO-169.
- Applied the forward migration to an owned prior-schema local stack, verified a
  clean unseeded rebuild, generated types from that stack and removed the stack.
- 15 focused unit/safety tests passed: 7 directory query, 3 network profile query,
  2 private-cache policy and 3 upgrade-verifier safeguards. Filter input coverage
  includes 80 supplementary Unicode characters and rejection without reads.
- 4 compiled Next.js integration checks passed: directory page, directory query,
  network profile page and protected profile-photo reads. The extended directory
  test checks combined RPC arguments and navigation URLs, reset controls, malformed
  filters without reads, filter-only empty results and missing-value labels, plus
  existing HTML/RSC access and private-field protections.
- Type generation, TypeScript, focused ESLint and diff checks passed.
- Independent review found no blocking security/matching/pagination defects. Its
  minor UTF-16/browser input-limit concern was verified and corrected.
- Inspected compiled HTML/CSS with fictional matching pilot data on desktop and
  375px mobile. Width checks at 320px, 375px and 640px found no horizontal overflow.
  At 320px each input is 272px wide; at 375px each is 327px; at 640px filters are
  176px across three columns. Screenshots: `/private/tmp/volo-170-desktop.png` and
  `/private/tmp/volo-170-mobile.png`. Temporary viewport overrides were reset.

The full suite and GitHub-only upgrade/concurrency verifier were not run locally,
per the focused-test policy. Both explicit verifier migration-history checks now
include this migration. CI and Netlify Deploy Preview verification await a PR.

## Release and files

Migration `20261020010000_directory_filters.sql` has only been applied locally.
Apply it through the separately approved hosted release workflow before publishing
this feature; previews share production Supabase. Keep automatic production
publishing locked. No founder product decisions remain unresolved.

Changed files:

- `app/(protected)/directory/page.tsx`
- `app/(protected)/directory/pilot-card.tsx`
- `app/(protected)/_components/pilot-details.tsx`
- `lib/profiles/directory-query.ts`
- `lib/profiles/directory-search.ts`
- `lib/supabase/database.types.ts` (generated)
- `supabase/migrations/20261020010000_directory_filters.sql`
- `supabase/tests/database/directory.test.sql`
- `tests/directory-query.unit.mts`
- `tests/directory-page.test.mjs`
- `scripts/verify-invitation-upgrade.mjs`
- `docs/volo-170-verification.md`

Preexisting modified `AGENTS.md` and untracked `docs/audits/` remain untouched.
