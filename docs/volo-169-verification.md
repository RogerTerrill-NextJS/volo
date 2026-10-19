# VOLO-169 — Directory name and home-airport search

Implemented on `feature/volo-169-directory-search` from merged VOLO-168
(`6feb2f7`). Scope comes from VOLO-169 and parent VOLO-41. The founder approved
one combined search field and the matching behavior before implementation.

## Behavior

- Search by a literal substring of either the public display name or home airport.
  Matching ignores case, trims surrounding whitespace, and collapses repeated
  whitespace in the search and stored display name. Blank search browses normally.
- Input is limited to 80 Unicode code points before whitespace normalization.
  Duplicate query parameters, non-string values, malformed Unicode and NUL are
  invalid; invalid input does not reach the query. HTML also bounds input length.
- Search is an explicit GET form at `/directory?q=...`; a new submission omits the
  old cursor. Next/first-page/retry links retain the normalized term. Clear search
  returns to the unfiltered first page. No-match and exhausted-page states remain
  recoverable, with service failures distinct from empty results.
- The input takes a full row on small screens. The form uses installed Next.js
  Form guidance, disables prefetching, and keys the input to reset after navigation.
- A forward migration replaces the directory function with one unambiguous
  three-argument signature. The search argument defaults to empty, so existing
  two-argument calls retain behavior. Filtering happens before the existing UUID
  ordering, bounded limit and lookahead; it never filters an already limited page.
- The function remains a stable security-invoker read with empty search path and
  authenticated-only execute permission. Existing profile RLS, active viewer/target
  membership checks and explicit public-field projection are reused. SQL uses
  literal substring matching, so `%` and `_` do not become wildcards.
- Existing uncached session transport, access/identity rechecks, timeout, card/photo
  handling and private response headers remain in place.

No new fields, indexes, preferences, dependencies or search service were added.
No hosted Supabase data/accounts/settings or production publication were changed.

## Verification

- Tests first failed for unsupported search input, missing search RPC signature,
  and absent search UI before their implementations were added.
- 113 SQL assertions passed in a disposable local Supabase stack: 53 directory/
  network-profile, 46 profile, and 14 membership assertions. Search coverage includes
  case/whitespace normalization, airport substrings, literal wildcard characters,
  late matches before pagination, cursor continuation, empty results, input bounds,
  and inaccessible targets/viewers. Existing field and RLS checks also passed.
- Applied the forward migration to an owned prior-schema local stack, then verified
  a fresh disposable rebuild after correcting a test fixture that violated the
  existing trimmed-name constraint. The schema constraint was unchanged.
- Generated database types from the disposable stack and removed the stack.
- 14 focused unit/safety tests passed: 6 directory query, 3 network profile query,
  2 private-cache, and 3 upgrade-verifier safeguards.
- 4 compiled Next.js integration tests passed: directory page, directory query,
  network profile page and protected profile-photo read. The extended directory
  test verifies normalized RPC arguments, retained search in pagination links,
  escaped input, malformed input without reads, clear/search controls and empty
  paginated results, alongside the existing HTML/RSC access and private-field checks.
- Type generation, TypeScript, focused ESLint and diff checks passed. Type generation
  used fictional local configuration after the ordinary environment correctly
  rejected missing public settings; no hosted credentials were needed.
- Independent read-only review found no actionable search/security/pagination defects.
  Its Next Form documentation concern was verified and corrected.
- Inspected compiled HTML/CSS with fictional pilots at desktop and 375px. Corrected
  a narrow mobile input; width checks at 320px and 375px showed no overflow and
  full-row inputs of 272px and 327px. Screenshots are `/private/tmp/volo-169-desktop.png`
  and `/private/tmp/volo-169-mobile.png`. Viewport overrides were reset.

The full suite and GitHub-only upgrade/concurrency workflow were not run locally,
per the focused-test policy. Both explicit migration-history checks include the
new migration; CI and Netlify Deploy Preview verification remain pending a PR.

## Release and files

Migration `20261019030000_directory_search.sql` is local only. It must be applied
through a separately approved hosted release before publishing the search feature;
Netlify previews share production Supabase. Keep automatic production publishing
locked. No founder product decisions remain unresolved.

Changed files:

- `app/(protected)/directory/page.tsx`
- `lib/profiles/directory-search.ts`
- `lib/profiles/directory-query.ts`
- `lib/supabase/database.types.ts` (generated)
- `supabase/migrations/20261019030000_directory_search.sql`
- `supabase/tests/database/directory.test.sql`
- `tests/directory-query.unit.mts`
- `tests/directory-page.test.mjs`
- `scripts/verify-invitation-upgrade.mjs`
- `docs/volo-169-verification.md`

Preexisting modified `AGENTS.md` and untracked `docs/audits/` remain untouched.
