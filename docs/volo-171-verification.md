# VOLO-171 — Directory privacy and ownership verification

Verified on `feature/volo-171-directory-privacy` from merged VOLO-170
(`b3ffef5`). Scope follows VOLO-171 and parent VOLO-43; the founder approved
focused test extensions and reuse of existing RLS/Auth evidence.

No application or schema defect was demonstrated. This change adds regression
coverage and evidence only; no production behavior, dependencies, grants,
policies, database fields or migrations change.

## Distinct coverage added

| Boundary | New evidence in existing tests |
| --- | --- |
| Account email privacy | Actual fixture Auth email is absent from directory/profile HTML and RSC, and profile action responses. Existing token/metadata canary protection is reused. |
| Extra RPC fields | Directory/profile payloads include private email, role, status, membership authority and photo-path canaries. Responses must exclude them while retaining permitted pilot fields. |
| Search and filters | Existing HTML checks now apply the stronger privacy assertions. Added search-only and combined-filter RSC requests assert the real normalized RPC arguments and safe pilot rendering. |
| Denied direct requests | Anonymous and disabled users cannot retrieve pilots through search/filter HTML or RSC requests, and cannot trigger a directory read. No new outage/refresh matrix. |
| Read-only browsing | Directory/profile requests cannot write profiles or call a membership write method. Profile query-string owner/role/status spoofing cannot retarget the profile, expose admin navigation or add edit controls. |
| Ordinary-member action tampering | Compiled updateProfile calls reject foreign user_id, role, status, membership and user/app metadata fields. Both profile rows remain unchanged, no profile storage request occurs, and no membership write is attempted. |

Tests use the existing `startMutationFixture`, Auth/profile backend, real compiled
Next.js routes and Server Action encoding. No second harness or new fixture API
was introduced. All data is fictional and requests stay in owned local fixtures.

## Reused enforcement evidence

- `supabase/tests/database/directory.test.sql`: explicit public RPC projection,
  authenticated-only grants, active viewer/target eligibility, direct targeted
  reads, search/filter behavior, revocation, and caller RLS.
- `supabase/tests/database/profiles.test.sql`: only the active owner can update;
  foreign user IDs, identity transfers, account authority and protected metadata
  cannot be written; admin sessions have no cross-owner edit override; disabled
  or unadmitted callers have no profile access. Positive owner writes still work.
- `supabase/tests/database/memberships.test.sql`: spoofed metadata cannot promote a
  member; browser clients cannot update/admit/delete memberships or reactivate a
  disabled account. Trusted service operations remain separately authorized.
- `tests/directory-query.unit.mts` and `tests/network-profile-query.unit.mts`:
  narrow DTOs, current access checks, session changes, bounded input and safe errors.
- Existing request-fixture token/metadata assertions and profile-save origin/input/
  outage checks are reused. The full Auth outage/session-refresh matrix is not
  duplicated for directory screens.

## Verification

- 128 existing SQL assertions passed on a disposable local database rebuilt from
  the merged migrations: 68 directory, 46 profiles and 14 memberships. This run
  used no seeds; no SQL tests or fixtures changed. Seeded/unseeded filter evidence
  remains recorded in VOLO-170. The owned database was removed after verification.
- 3 extended compiled Next.js integration tests passed: directory page, network
  profile page, and profile Server Actions. Final runs include the stronger email
  assertions, filtered HTML/RSC denial checks and ordinary-member tampering cases.
- 10 existing directory/network-profile query unit tests passed.
- Focused ESLint and diff checks passed. Independent source review found no
  actionable issues in the privacy/ownership test extensions.

The extended checks verify protections already present, so no production fix or
migration was required. The full suite, full Auth matrix, hosted Supabase checks
and Deploy Preview checks were not run. CI verification awaits a PR.

## Files and remaining decisions

Changed files:

- `tests/directory-page.test.mjs`
- `tests/network-profile-page.test.mjs`
- `tests/profile-save.test.mjs`
- `docs/volo-171-verification.md`

No unresolved founder decision or blocker. No hosted data/accounts/settings,
external messages or production publication changed. Preexisting modified
`AGENTS.md` and untracked `docs/audits/` remain untouched.
