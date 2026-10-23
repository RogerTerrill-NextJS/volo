# VOLO-192 — Owner-only incoming requests

Implemented on `feature/volo-192-incoming-requests` from merged VOLO-191
(`aa9d3d4`). Parent: VOLO-65. The user approved the bounded design and requested
a PR. Installed Next.js data-security and data-fetching guides were reviewed.

## Behavior and access boundary

An owner's existing flight detail now shows Incoming requests with flight context.
Each entry shows current request state, the introduction (or an empty fallback),
first-requested time in UTC, and the permitted requester name, home airport and
profile link. Unavailable/inactive profiles use a fixed fallback while preserving
the owner's request history. All five request states are displayed; no decision,
withdrawal, messaging or lifecycle controls are introduced.

The server-only query uses the viewer's ordinary Supabase session and existing RLS.
It verifies current active membership and actual ownership before reading request
rows, then rechecks ownership and viewer identity before returning the result.
Unrelated owners and administrators receive no owner-list grant, including when
they can see the NETWORK flight or their own request. The page mounts the list
only in its existing owner action slot.

Request fields are explicitly selected, validated and projected. Requester lookup
reuses the existing RLS-backed network-profile boundary and projects only name,
home airport and the bound profile identity. It exposes no account emails,
membership metadata, storage paths or provider diagnostics. Authorization failures
discard the list; optional missing/failed profile lookup uses the fallback.
Reads remain private/no-store with retries disabled and bounded transport timeouts.

Pages contain at most 20 entries, newest creation time first with descending UUID
as tie breaker. A strictly validated timestamp/UUID cursor preserves PostgreSQL
microseconds and bounds the PostgREST filter syntax. The lookahead row has no
profile lookup and is not returned. Next-page and first-page links disable
prefetching. Invalid, loading, empty and retry states use the existing page and
Suspense patterns. Resubmission retains the original creation time, so the label
explicitly says First requested.

## Verification

| Check | Result |
| --- | --- |
| Initial owner-query tests against stub | Five expected missing-behavior failures |
| Incoming, own-interest, detail, network-profile and form-state units | 23 passed |
| Real Auth, compiled native/fetched actions and actual flight pages | 18 scenarios passed |
| Route type generation, TypeScript, focused ESLint and diff checks | Passed |
| Independent review | Timeout issue fixed and re-reviewed; no remaining actionable findings |

The new integration cases verify owner empty/list states, pending/accepted/cancelled
feedback, unrelated-admin ownership isolation through page and direct RLS reads,
inactive requester profile fallback, 21 real requests across two pages (including
equal creation timestamps), malformed cursor rejection, outage recovery and no
account-email leakage in owner HTML/RSC. Existing submission, concurrency, PRIVATE
visibility and retry cases continue to pass. New units cover all five states,
revoked/changed viewers, ownership loss, malformed/foreign/unordered rows,
pagination limits, safe profile projection and failures. The new query units are
included in the existing flight-unit CI command; integration reuses its existing
Auth runner and disposable resources.

Review identified that a shared five-second read deadline could expire during an
optional profile lookup and abort the final ownership recheck. Each operation now
gets a fresh bounded session client. A local fixture delays the requester-profile
RPC beyond its timeout and verifies requests remain visible with the profile
fallback. The corrected full focused integration run passed.

Browser checks used production CSS, fictional local pilots and a long unbroken
introduction. Loading transitioned into the owner list; a separate flight showed
the empty state. At 390px and 320px, document width equalled viewport width. Keyboard
Tab navigation reached the requester profile link with a visible 2px focus outline.
These are Chrome viewport/keyboard checks, not physical-device or screen-reader
certification. The viewport override was reset, tab closed and owned local app,
Auth/database resources and temporary credential file cleaned up.

The full historical suite, separate pgTAP/upgrade runs and hosted Netlify preview
were not run under the focused-test policy. No schema or RLS changes were needed;
the integration fixture uses real PostgreSQL with all current migrations.
Hosted preview verification and production release verification remain separate.
No hosted data/settings, migration application, merge or production publishing
occurred. Automatic production publishing remains locked. Unrelated `AGENTS.md`
and `docs/audits/` changes are preserved and excluded.
