# VOLO-119 — Real Auth integration and session handoff

Status: written spec approved; implementation plan awaiting review.

## Purpose and agreed scope

Close VOLO-24's session-foundation work by proving that the merged clients,
Proxy, identity/membership guards, protected pages, mutation helpers and private
response policy work together with real disposable Supabase Auth and PostgREST.
Deliver repeatable integration tests, a separate CI job, and an evidence-backed
handoff to the remaining auth features. The user approved this scope and CI as
the practical execution environment because Docker is unavailable on this Mac.

Use `feature/` branches. Netlify has Deploy Previews and production only.
Previews share production Supabase. Hosted authenticated writes, account creation,
email, callback activation and production publication are outside this work.
The unresolved Netlify Age/non-storage evidence remains explicitly deferred in
VOLO-120; neither this suite nor a green CI job establishes that CDN result.

## Current foundation and missing evidence

The regular CI job uses synthetic public configuration. Existing HTTP suites run
real compiled Next.js and Supabase SDKs against fictional Auth/membership servers.
They cover deterministic failures, response ownership, cache isolation and
mutation transport, but do not establish real Auth issuance/refresh/revocation or
actual HTTP RLS behavior. The database job runs pgTAP against local Postgres; its
seeded `auth.users` rows have no usable credentials or identities.

`getAccess()` creates a fresh read-only server client, calls `getUser()`, then
reads only the verified subject's membership under that user's RLS context.
Membership must be active; explicit role checks determine privileged access.
Proxy owns cookie rotation and forwards updated request cookies. Read-only
guards refuse authorization if they must perform an unpersisted refresh.
Writable clients require a response-header sink before writing cookies.
The page helper redirects unauthenticated requests to the fixed
`/login?reason=authentication-required`; denied membership renders a generic
denial. Mutation helpers independently enforce build-pinned origin, current
access, role, input and resource policy before effects.

## Chosen approach and alternatives

Add an isolated full-stack Auth integration job alongside the existing app and
database jobs. It runs the pinned Supabase CLI and existing SDK dependencies,
starts local services on the CI runner, applies checked-in migrations, provisions
fictional Auth accounts, and tests a disposable compiled Next.js fixture that
imports the real product code. This supplies missing evidence without shipping
test endpoints or changing product interfaces.

Installing Docker locally would provide the same workflow but adds workstation
setup and is not required for this ticket. Extending only the simulated suites
would be faster but would not satisfy the real-Auth acceptance criteria.

## Disposable service lifecycle and credentials

- Create a unique temporary Supabase project directory using the checked-in
  migrations and a copy of local configuration. Start the pinned CLI's full
  local stack, including Auth and API; `supabase db start` alone is insufficient.
- Use a run-owned project ID and ports that do not conflict with an existing
  developer stack. Do not alter root local config, link a remote project, run
  remote commands, or reset an existing developer database.
- Discover credentials from that owned local stack programmatically. Reject
  non-loopback API/database destinations and malformed/credential-bearing URLs
  before provisioning, signing in, changing membership or cleanup. Do not read
  production `.env.local` or inherit hosted Supabase settings as a fallback.
- The Node test controller alone receives local admin credentials. The compiled
  Next fixture receives only the local API URL and public key. No privileged
  client is added to product code or browser bundles.
- Provision accounts through the real local Auth Admin API, with confirmed
  fictional `example.invalid` email addresses and random per-run passwords.
  Public signup remains disabled. No invitation/reset email is necessary.
- Create A and B active members, an active admin, a disabled member and an Auth
  user without membership. Use real returned Auth UUIDs; insert memberships
  through the controller with the migration's disabled-state fields respected.
- Use `finally`/CI `always()` cleanup. Delete owned membership rows before Auth
  users because their foreign key restricts deletion; stop only the owned stack
  and remove its temporary files. Do not stop other stacks or prune Docker.
- Missing Docker/services is an actionable failure for the integration command,
  never a silent skip or a simulated fallback. Ordinary tests still run without it.

## Next.js test application and transport

Build one temporary Next.js production fixture using the merged `lib`, Proxy,
protected shell and configuration. Add test-only routes/forms to that directory:
minimal subject/role reads, a policy-guarded JSON mutation, and guarded native and
fetched Server Actions. A controller-owned loopback effect recorder proves which
subject performed an effect and that rejected requests performed none.

Establish sessions with real password sign-in through `@supabase/ssr` and retain
independent A/B cookie jars. Apply each response's cookie changes before the next
request. Exercise actual HTTP requests, canonical RSC negotiation and compiled
Action transports using the existing fixture conventions. Do not mock identity
or membership in this suite, handcraft valid sessions, or bypass guards to get
positive results. Restrict fixture outbound fetches to the owned local services.
Test endpoints and account controls never enter the deployed product app.

Assertions cover useful output and effects, not only status codes. Check that
neither tokens, passwords, service keys nor another user's data appear in bodies,
browser-visible non-cookie headers, static assets or captured logs. Set-Cookie is
an intentional credential transport: inspect it in memory without printing it.
Error reporting must be sanitized before emitting child-process/SDK diagnostics.

## Required real-service scenarios

| Scenario | Required evidence |
| --- | --- |
| Anonymous access | Protected HTML reaches fixed login; protected JSON/Actions deny; no effects or private subject output. |
| Admission and roles | A/B and admin receive their own minimal subject/role; disabled/absent membership denies; member cannot execute admin policy; admin succeeds. |
| Current membership | Disable A and change an admin's role through the local controller; subsequent requests using unchanged credentials reflect the current row and deny affected effects. Reactivation recovers. |
| Actual RLS | Public-key user clients can read only their own membership; cross-user reads expose no row; member/admin session cannot insert, promote, reactivate or delete memberships. Controller setup success provides a positive control. |
| Credential integrity | Corrupted signature and malformed session deny without effects. A real expired access token with invalid refresh denies; forged test data is a negative input only, never a working session. |
| Refresh persistence | Explicit real refresh rotates credentials; old/updated cookie jars remain isolated. Naturally expired real access credentials with a valid refresh traverse Proxy, emit usable updated cookies and succeed again on a subsequent request. |
| Session termination | Sign out a local session, retain its old credentials, then probe real `getClaims`, `getUser`, refresh and application access separately. Assert revoked refresh cannot establish a new session and document access-token behavior accurately. |
| Request isolation | Alternate and concurrently issue A/B/anonymous requests to identical HTML/RSC/JSON URLs; no foreign subject or cookies; guarded effects match the caller. Empty prefetch is allowed but must contain no private subject and retain no-store. |
| Origin enforcement | JSON and native/fetched Actions reject missing/foreign/null origins without effects; same-origin positive controls succeed. Use real compiled transports and build-pinned fixture origin. |
| Response caching | Protected/session-bearing redirects, reads and mutation responses carry effective browser/CDN no-store; public/static controls retain cacheability. No claim about Netlify storage from local headers. |

For natural expiry, set a short supported JWT lifetime only in the owned stack's
temporary configuration. Read real session expiration and wait within an explicit
bounded timeout; never edit a valid JWT's expiry or substitute fake token clocks.
Use separate sessions for destructive credential cases so rotation/revocation does
not contaminate later assertions. The written plan will resolve the exact supported
CLI configuration and test duration from pinned tooling before implementation.

`getClaims` verifies signature/expiry and may not detect termination of an
unexpired session; `getUser` contacts Auth. Measure behavior of the actual pinned
stack and signing mode, including any difference from the existing simulated
fixtures. Do not assume immediate JWT invalidation on sign-out, or equate current
membership rejection with JWT revocation. Unexpected acceptance or status mapping
is a reported integration finding, not an automatically updated test baseline.
If real behavior contradicts the security contract, stop and present the finding
before changing product authorization semantics or calling the work complete.

## Failure coverage and scope control

Retain the existing deterministic suites for Auth/membership outage, malformed
backend responses, deadlines and safe recovery. Their simulated evidence must be
labeled separately from the new real-service scenarios; do not disrupt shared
hosted services or inject faults into a developer's existing stack. Combine their
results in the integration evidence matrix without pretending every failure was
produced by real Supabase.

No new product login/logout, callback, schema, admission, privileged operation or
email flow is planned. A narrow integration defect can be proposed with its
failing evidence, but any change to product behavior needs an explicit scoped
decision. The existing cookie-expiry comparison flake remains a separately
recorded minor unless it blocks this verification and is deliberately addressed.

## CI and local command

Expose one documented opt-in integration command, separate from `npm test` and
the current fixture commands. A dedicated Ubuntu CI job installs locked packages,
starts the owned local stack and runs it with a timeout covering startup, one
fixture build and bounded expiry. It uses no repository/hosted secrets and uploads
only a sanitized result summary on success/failure. CLI status output containing
keys must not be streamed into Actions logs or artifacts.

Keep the existing app validation and database/pgTAP jobs intact. Their full checks
remain required. On this Mac, verify controller safety cases and all runnable
checks locally; report real-service execution as pending until the exact-head CI
integration job actually passes. Docker-enabled developers can run the same
command without editing their normal app environment or resetting their stack.

## Documentation and handoff

Add a concise session-integration guide linked from README, Supabase setup and
environment documentation. Include commands/prerequisites, data ownership,
credential handling, route/guard/cookie interfaces, failure mappings and an
evidence matrix distinguishing real-service, simulated, browser and hosted checks.
Update stale descriptions of the now-implemented session foundation without
rewriting dated hosted observations as current facts.

The handoff assigns: invitation-gated establishment to VOLO-21; login/logout and
Router Cache invalidation to VOLO-22; recovery/mail to VOLO-23; exact
`/auth/confirm` activation and redirect evidence to VOLO-107; hosted authenticated
verification and release evidence to VOLO-110; Netlify Age/non-storage reporting
to VOLO-120. Browser history may restore already-delivered content; refresh must
reauthorize. Do not mark downstream tickets complete from local fixture evidence.

## Completion evidence

Before declaring VOLO-119 ready for review: exact-head app, database and real Auth
integration jobs pass; all applicable local checks pass; the fixture's authorization
positive/negative controls produce expected output/effects; docs name remaining
limits and handoffs. Verify the exact PR's Deploy Preview commit/runtime and
anonymous public/protected navigation with no authenticated hosted writes. Record
VOLO-120 as an approved deferral, not a passed cache check. Production stays locked.
VOLO-119 becomes Done only after the user merges and ancestry is verified.

## References

- [VOLO-119](https://outsidethecockpit.atlassian.net/browse/VOLO-119)
- [VOLO-120](https://outsidethecockpit.atlassian.net/browse/VOLO-120)
- [Supabase SSR advanced guide](https://supabase.com/docs/guides/auth/server-side/advanced-guide)
- [Supabase getClaims](https://supabase.com/docs/reference/javascript/auth-getclaims)
- [Supabase local development](https://supabase.com/docs/guides/local-development/cli/getting-started)
- Installed Next.js guides: `node_modules/next/dist/docs/01-app/02-guides/testing/index.md`,
  `authentication.md`, `server-actions.md`; API references for Proxy and cookies.
  Read the relevant guides again before writing implementation code.
