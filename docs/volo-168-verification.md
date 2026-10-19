# VOLO-168 — Read-only network pilot profile

Implemented on `feature/volo-168-network-profile` from merged VOLO-167
(`2e67153`). The founder approved the route, eligibility rule and read-only
design before implementation.

## Behavior and boundaries

- Directory card names link to `/directory/[userId]`, with prefetch disabled.
- The profile page shows only the existing network-visible fields and reuses
  protected profile photos and initials fallback. A shared `PilotDetails`
  component keeps the directory and profile field display consistent.
- Both self-viewing and viewing another member are read-only. There are no
  target edit controls or administrative overrides. The existing My profile
  navigation link still leads to the viewer's own editor.
- The new invoker RPC `get_network_profile(uuid)` selects exactly one target
  using its primary key and the existing guarded active-membership predicate.
  Existing profile RLS applies. No membership read grants, policies, tables or
  fields were added, and no privileged application client is used.
- The server helper shares the directory's safe projection and bounded,
  uncached session transport. It checks access before reading, validates target
  identity, and rechecks viewer identity/access before returning a result.
- Missing, inactive, unadmitted, incomplete or invalid targets share the same
  missing response. For admitted viewers the page renders a generic 404;
  unauthenticated/disabled viewers are handled before target lookup.
- Backend failure is a recoverable unavailable state, distinct from missing.
  Unexpected errors reload through the server guard without displaying internal
  error details. The existing directory error retry also uses a reload button,
  preserving its fresh-access behavior and satisfying Next navigation lint.
- The existing `/directory` descendant cache rule covers this page for private
  HTML/RSC/browser/CDN responses. Profile reads finish before rendering, retaining
  a true 404 for missing targets rather than streaming the result as a 200.

No new profile preferences, fields, dependencies, search, filters or hosted
operations are included.

## Verification

- Tests first failed for the missing RPC/export/page before implementation.
- 99 focused database assertions passed: 39 directory/network-profile,
  46 existing profile, and 14 membership assertions. This includes exact target
  reads, own/other visibility, denied viewers, inactive and missing targets,
  unchanged membership RLS, safe fields, revocation and photo availability.
- Applied the new forward migration to an owned prior-schema disposable
  Supabase stack using local migration push. Generated database types from that
  stack and removed the stack after verification.
- 13 focused unit/safety tests passed: 3 new profile-query tests, 5 directory
  query, 2 private-cache policy, and 3 upgrade-verifier safeguards.
- 4 compiled Next.js checks passed: new network-profile page, existing directory
  page, existing directory query and existing protected profile-photo read.
  The new test covers the requested target, member/admin/own viewing, no target
  editing or writes, safe public fields, photos/fallbacks, card links, malformed
  and missing IDs, outages and direct HTML/RSC access checks.
- Type generation, TypeScript, focused ESLint and diff checks passed.
- Independent read-only review found no actionable defects.
- Visual QA inspected the compiled page HTML/CSS with fictional pilot data at
  desktop and 375px. Width checks at 320px, 375px and 640px found no horizontal
  overflow. Screenshots: `/private/tmp/volo-168-desktop.png` and
  `/private/tmp/volo-168-mobile.png`. Viewport overrides were reset and the owned
  preview fixture was stopped.

The full suite and the GitHub-only concurrency/upgrade verifier were not run
locally. Both explicit verifier migration-history checks now include
`20261019020000`; CI must verify its full upgrade/concurrency workflow. Netlify
Deploy Preview and production verification remain separate and pending.

## Release and files

The migration has not been applied to hosted Supabase. It depends on VOLO-166's
directory migration and must use the separately authorized hosted release
workflow. Without the RPC, the page fails safely with retry feedback. No hosted
data/settings changes or production publication occurred.

Changed files:

- `app/(protected)/directory/[userId]/page.tsx`
- `app/(protected)/directory/[userId]/not-found.tsx`
- `app/(protected)/directory/[userId]/error.tsx`
- `app/(protected)/directory/pilot-card.tsx`
- `app/(protected)/directory/error.tsx`
- `app/(protected)/_components/pilot-details.tsx`
- `lib/profiles/directory-query.ts`
- `lib/supabase/database.types.ts` (generated)
- `supabase/migrations/20261019020000_network_profile_query.sql`
- `supabase/tests/database/directory.test.sql`
- `tests/network-profile-query.unit.mts`
- `tests/network-profile-page.test.mjs`
- `tests/helpers/access-fixture.mjs`
- `package.json`
- `scripts/verify-invitation-upgrade.mjs`
- `docs/volo-168-verification.md`

Preexisting modified `AGENTS.md` and untracked `docs/audits/` remain untouched.
