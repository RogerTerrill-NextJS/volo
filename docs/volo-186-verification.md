# VOLO-186 — Flight visibility through actual read surfaces

Approved bounded verification on `feature/volo-186-flight-visibility-verification`,
based on reviewed VOLO-185 / `ef006fa`. Parent VOLO-61 asks for read-surface
verification using VOLO-60's existing policy fixtures. The installed Next.js
data-security and testing guides were reviewed. No product behavior is changed.

## Coverage and reuse

The existing disposable Supabase/compiled Next app, real session cookies, creation
actors, `pageRead` privacy checks, and recipient Server Action transport helpers
are reused. These scenarios run through the focused `--flight-feed` path and the
normal combined CI runner; there is no additional harness, framework, account
type or deployment.

Two scenarios extend `tests/helpers/flight-feed-cases.mjs`:

- Actual listing and detail HTML/RSC responses for three uniquely marked future
  flights: one NETWORK and two PRIVATE. The owner and selected recipient can read
  all three. Unrelated active members with no profile, including an admin, can
  read only NETWORK. Disabled and absent memberships get the access-denied state;
  anonymous requests redirect to the fixed login destination (HTTP 307 documents,
  a fixed redirect digest in HTTP 200 RSC). Inaccessible details
  return the safe missing state (HTTP 404 documents; HTTP 200 streamed RSC, per the
  installed Next.js `not-found` guide). Hidden markers never enter bodies, and
  hidden identifiers stay out of listing payloads. Successful representations are
  checked for their HTML/RSC content types so an empty response cannot pass.
- Native and fetched guarded recipient removal/re-add, followed by those same
  listing/detail reads without resetting cookies or signing in again. Removal
  revokes only the affected PRIVATE flight; owner access, NETWORK access and a
  different selected PRIVATE flight remain intact. Re-add restores reads. Disabled
  membership overrides a retained selection, while membership reactivation does
  not resurrect a removed selection.

Existing shared assertions check browser/CDN/Netlify `no-store`, credential and
private-email exclusion on every page response. Action responses receive the
same privacy checks. All fixture records join the existing owned-ID cleanup;
membership changes are restored in `finally` blocks.

The flight page reader now follows the same bounded, same-origin/same-path `_rsc`
negotiation as the shared Auth page reader. Each negotiation response is privacy
checked; login redirects remain observable. This closes a verification gap where
a negotiation redirect's empty body could satisfy a negative-only RSC assertion.
Initial runs exposed the negotiation gap and incorrect new test assumptions about
document versus streamed not-found/redirect status codes. Expectations now follow
the installed Next.js guides and existing Auth/smoke tests. These corrections are
confined to verification code; missing/redirect checks still exclude all protected
markers, and streamed redirects must contain the exact fixed login digest.

The earlier scenarios already cover direct session queries and minimal DTOs,
cursor/membership revocation, in-flight membership changes, provider outages,
private notes/escaping, pagination, local dates, ownership and lifecycle states.
Those assertions remain in the focused run instead of being duplicated.

## Verification

| Check | Result |
| --- | --- |
| Compiled real-session feed/detail integration (`--flight-feed`) | 11 passed, 0 failed |
| New read-surface matrix and guarded recipient-change scenarios | Both passed |
| Focused ESLint, JavaScript syntax and diff checks | Passed |
| Independent read-only code review | No actionable findings |
| Owned app/database cleanup | Completed, runner exit 0 |

No production code was changed, so no implementation red/green claim is made.
Initial test-development failures are described above; the final focused run is
green. Full historical Auth/creation/RLS suites and unrelated units were not run.
The compiled fixture builds the real flight pages and invokes their real actions.

### CI timing correction

The combined CI runner exposed a short-token timing issue that the initial
feed-only run missed. The owned fixture JWT lasts 120 seconds, so it enters the
SDK's 90-second refresh window after only 30 seconds. A multi-check page render
can cross that boundary after proxy verification; the production read-only access
check correctly fails closed if it must refresh without persisting cookies.

A controlled local probe used the existing read-delay control with a retained
session: 91 seconds remained before the read, 89 afterward, and the lifecycle page
returned unavailable instead of notes. An ordinary combined local run also failed
later on a NETWORK listing marker, confirming that assertion location varied with
timing. No security expectation was relaxed.

The flight page test reader now explicitly refreshes its owned cookie jar when
less than 110 seconds remain, giving the read headroom before the SDK window.
This keeps the same Auth session and never signs in again, resets cookies, or
changes membership/recipient state. Both the initial read and any RSC negotiation
receive preparation. Expiry/refresh behavior remains covered by the existing Auth
scenarios; these flight scenarios verify current membership and visibility.
Lifecycle assertions now include safe labels so sanitized CI output identifies
the failed behavior without exposing response bodies or credentials.

Post-fix controlled probe: the same jar refreshed before the read (120 seconds
remaining before, 118 after), and the lifecycle detail rendered successfully.
All 29 combined creation/recipient/feed/detail scenarios then passed, including
both VOLO-186 cases; the owned app/database cleanup completed with exit 0.
Focused ESLint, syntax and diff checks passed. Independent read-only review found
no actionable issues. This local probe invokes the same `verifyFlightCreation`
combined path as `--flight-create`, with the boundary aged before page preparation
and the existing read-delay control enabled for that one read. The unmodified
combined path had failed before the fix. Hosted CI confirmation follows the push;
the full historical Auth suite was not run locally for this correction.

## Limits and remaining work

VOLO-63/64 own request-action visibility when requests exist. VOLO-172's approved
cancel-request/close-sending/read-only-history contract must be integrated by the
owning request/conversation migrations; the current recipient function still
fails closed if those future tables appear without that integration. Neither
future scope blocks this read-surface verification.

Full historical Auth tests, interactive browser history/cache behavior and hosted
Netlify preview/release verification are outside this targeted run. Local response
headers do not prove hosted CDN storage behavior. No schema/RLS/application code,
dependency, hosted Supabase data/settings, merge or production publication changes.
No new founder product decisions are required. Unrelated `AGENTS.md` and
`docs/audits/` work is preserved and excluded.
