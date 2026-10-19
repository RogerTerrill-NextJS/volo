# VOLO-166 prerequisite review — 2026-10-19

Status: eligibility and query design approved by the founder; implemented for review.
Branch: `feature/volo-166-pilot-directory`, based on `670118e`.

## Verified prerequisites

- Read Jira VOLO-166 and its authoritative parent VOLO-39. Neither specifies
  opt-out behavior or directory visibility preferences.
- Jira marks profile schema (VOLO-33), onboarding (VOLO-34), editing (VOLO-35),
  photos (VOLO-36), and licensed-only profiles (VOLO-236) Done. Their code and
  migrations exist in this checkout. Hosted migration state was not inspected.
- Read installed Next.js 16.3.8 guides `01-app/02-guides/data-security.md`
  and `01-app/01-getting-started/06-fetching-data.md`.
- Local Docker is available (29.8.2). Use owned local/disposable Supabase
  resources for database tests; do not use hosted credentials or data.

## Reusable boundaries and gap

- `lib/auth/access.ts`: verified identity and fresh active-membership decision;
  never use user metadata as authorization or accept caller-supplied membership.
- `lib/supabase/server.ts`: request-scoped, read-only session client with the
  public key. `lib/profiles/query.ts` provides bounded, uncached read conventions.
- `lib/profiles/validation.ts`: existing licensed-pilot profile rules.
- `lib/profiles/photo-read.ts`: current protected photo lookup; directory output
  can expose photo availability without exposing object paths or signed links.
- `profiles_read_active_member` checks the **viewer**, not the profile owner.
  The existing database test explicitly allows an active viewer to read a
  disabled member's retained profile. A plain profile listing is insufficient.
- `memberships_read_own` prevents a session client from reading other members'
  status. Joining profiles to memberships directly would omit other pilots.
- No directory query, visibility column, or opt-out preference was found in
  application code, migrations, or the relevant Jira descriptions.
- VOLO-34 explicitly permits active members without a completed profile to
  browse; directory access must not introduce a viewer completion requirement.

## Approved decision

The founder approved listing every active member with an existing completed
licensed profile, including admins and the viewer, without an opt-out for this
ticket. No new profile fields or preferences were added.

## Implementation

- Add a server-only directory query that performs a fresh existing membership
  check, uses the session client, and returns sanitized errors.
- Explicitly project `user_id`, `display_name`, `home_airport`,
  `pilot_designation`, `certificates`, `ratings`, `aircraft_access`,
  `flying_interests`, `bio`, and a derived `photoAvailable` boolean. Do not return
  account emails, membership rows, roles, timestamps, or Storage paths.
- Use deterministic UUID cursor pagination, default 20 rows and maximum 50,
  fetching one extra eligible row to determine the next cursor. Check active
  target membership before applying the page limit.
- Add a narrow database eligibility helper and invoker query as needed, keeping
  profile reads subject to existing profile RLS. Any privileged helper must be
  read-only, fixed-search-path, callable only by the intended role, and guarded
  by current viewer membership. Do not broaden membership table read access.
  No new database fields or visibility preferences are proposed.
- Add focused database/query tests for anonymous, unadmitted and disabled
  viewers; active/inactive targets; metadata spoofing; safe output; paging;
  malformed inputs; and unavailable backend behavior. Reuse existing fixtures.
- No directory UI, search, filters, VOLO-167 work, hosted changes, or deployment.

## Baseline verification

Focused existing profile validation and membership transport tests were selected.
The initial sandbox run passed four profile tests; the membership fixture was
blocked by loopback `listen EPERM`. The rerun with loopback access passed all
five tests (four profile validation tests and one membership transport test).
The new directory unit and compiled Next.js tests pass. The final focused
database run passed 23 directory, 46 profile, and 14 membership assertions
(83 total), including default/maximum page bounds and function privileges.
The existing compiled profile-photo read regression also passed. Disposable
Supabase resources were removed after verification. Independent code review
found no actionable issues.
Type generation and TypeScript checking passed, as did lint on changed code.
The full suite, Deploy Preview and production verification have not been run.

Existing modified `AGENTS.md` and untracked `docs/audits/` predate this task and
are left untouched.

## Consumption and handoff

Use `listDirectoryProfiles({after?, pageSize?})` from
`lib/profiles/directory-query.ts` in a server context. Default page size is 20;
the accepted range is 1–50. An authorized result contains `rows` and
`nextCursor`; pass a non-null cursor as `after` for the next page. Null means
there is no next page in that query snapshot. Results are live pages rather
than a snapshot held across requests; membership/profile changes can change
later pages. UUID ordering avoids mutable-name cursor ambiguity.

The SQL RPC returns up to page size plus one lookahead row; application callers
should use the server helper, which strips that extra row and returns the
cursor. Empty results are authorized; invalid input, denied access and backend
failure are distinct statuses. Calling surfaces must retain the existing
private response headers; this ticket adds no public endpoint or UI.

`directory_private.active_profile_owner` performs only a membership predicate,
with a fixed empty search path, and is not in a PostgREST-exposed schema.
`list_directory_profiles` runs as invoker, preserving existing profile RLS and
membership-table restrictions. No privileged client is used by the helper.

Run query unit tests with `npm run test:directory:unit` and the compiled helper
test with `node --test tests/directory-query.test.mjs`. The existing database CI
job automatically picks up `supabase/tests/database/directory.test.sql` in its
seeded and seedless checks. Types were generated from an owned disposable stack.
No hosted migration has been applied. Apply the forward migration only through
the separately authorized release workflow before using this query in a hosted
environment. VOLO-167 remains unstarted pending founder review of VOLO-166.

## Files added or modified for this ticket

- `lib/profiles/directory-query.ts`: guarded server query and safe DTOs.
- `supabase/migrations/20261019010000_directory_queries.sql`: private eligibility
  predicate and paginated invoker RPC; no new table fields.
- `lib/supabase/database.types.ts`: generated RPC signature.
- `supabase/tests/database/directory.test.sql`: 23 database assertions.
- `tests/directory-query.unit.mts`: five focused query tests.
- `tests/directory-query.test.mjs`: compiled server/session/RPC integration.
- `tests/helpers/access-fixture.mjs`: directory RPC response fixture.
- `tests/helpers/mutation-fixture.mjs`: optional test-only directory route.
- `package.json`: focused unit-test command.
- `.github/workflows/ci.yml`: run directory unit tests in CI.
- `docs/volo-166-preflight.md`: decisions, implementation and verification handoff.
