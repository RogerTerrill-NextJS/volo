# VOLO-189 — Guarded interest submission

Implemented on `feature/volo-189-interest-submission`, based on merged VOLO-188
(`7093211`). The user approved the bounded Server Action + atomic session RPC
approach and requested a PR. They approved rejecting new interest on full flights.
The installed Next.js data-security and Server Actions guides were read.
The Interested UI and pending-feedback presentation remain with VOLO-190.

## Submission contract

`submit_flight_interest(p_flight_id uuid, p_introductory_note text default null)`
executes only for authenticated callers. It derives requester identity from
`auth.uid()`, checks current active membership and a completed licensed profile,
and holds those rows against concurrent changes. It accepts no caller-selected
requester, owner, status, role or timestamps. Direct member request-table writes
remain closed; ordinary admins have the same profile and flight-eligibility rules.

Before request-row reads/writes, the RPC locks the flight using the existing
lifecycle protocol. It checks active owner membership, self-request denial,
future/open availability and current PRIVATE selection. Missing, unselected,
self-owned, unavailable-owner, past, cancelled, completed and full flights share
`flight_unavailable`, without returning flight/audience/accepted-pilot data.

| Existing request | Result |
| --- | --- |
| None | Create pending if currently eligible and not full |
| pending or accepted | `already_requested` with its UUID and current state; no note/timestamp mutation |
| withdrawn | Return to pending on the same UUID with the submitted note, only after fresh eligibility and capacity checks |
| declined or cancelled | `request_closed`; no reactivation |

An existing pending/accepted request can be confirmed while a flight is full;
this is a no-op, not new interest. Basic flight eligibility still applies before
confirmation. Capacity is joining places minus accepted requests, checked under
the same lock as acceptance/removal. Pending interest does not reserve capacity.
Full-flight rejection adds no waitlist, counter or duplicate request history.
The VOLO-188 trigger continues to enforce structural/lifecycle invariants.

The optional introduction retains the existing 500-character limit. Empty maps
to NULL; text is preserved. The TypeScript parser counts Unicode code points to
match PostgreSQL, accepts exactly `flight_id` and optional `introductory_note`,
and rejects authority fields and malformed values.

`submitFlightInterest` uses existing origin, verified identity, current membership
and completed-profile guards with a 4 KiB form boundary. It uses the existing
session-scoped mutation client: five-second request/body deadline, no-store,
redirect errors and disabled write retries. Safe results contain only fixed codes,
messages and validated request UUID/state. Database errors and malformed provider
confirmations are not echoed or reported as success. An uncertain result asks the
caller to check status before retrying; uniqueness and the existing-record result
allow a later explicit confirmation without creating another row.

No production UI, page or alternate HTTP API is introduced. The compiled test-only
form exercises the real Server Action; VOLO-190 will reference it from flight detail.
Acceptance/withdrawal operations, conversations, notifications and moderation remain
with their owning tickets. No hidden-flight column currently exists; moderation
must integrate its availability rule before introducing hidden records.

## Verification

| Check | Result |
| --- | --- |
| Parser before implementation | Expected missing behavior assertion failure against initial stub |
| Guarded SQL operation before implementation | Expected missing-function assertion failure |
| Submission, requests, recipients, flight schema/creation, memberships, profiles | 324 pgTAP assertions passed with seeds; 324 without seeds |
| Actual session RPC with overlapping transactions | Five cases passed: duplicate, both creation/removal orders, acceptance capacity, submission after final place accepted |
| Real Auth and compiled native/fetched interest actions | Eight scenarios passed |
| Existing flight creation/recipient/feed/detail integration | 29 scenarios passed |
| Focused interest/recipient/creation/mutation unit checks | Passed |
| Additive migration | Existing fictional Auth/member/profile/flight/recipient/request hashes unchanged, including introduction and timestamps |
| Clean rebuild without seeds and actual generated-type drift | Passed |
| Next route types, TypeScript, focused ESLint and diff check | Passed |
| Independent review | One fixture-hook finding fixed; final review found no further actionable issues |

The interest integration cases verify requester derivation, NETWORK/PRIVATE access,
member/admin profile gates, disabled/unadmitted/anonymous and exact-field/origin/body
rejection, safe duplicate and resubmission behavior, terminal records, full-flight
new/resubmission rejection, direct-RPC/table bypass denial, disablement after server
checks, last-place acceptance immediately before SQL, and committed-but-lost or
malformed confirmation without automatic retry. Responses are checked for private
headers and credential/email/error-canary leaks. Tests use only owned local data.

The first real-Auth run caught an unreachable race hook in the test fixture; it was
moved alongside the other RPC hooks, and all eight scenarios passed afterward.
The temporary upgrade-preservation driver initially left its sample request in
place before pristine-database SQL tests; clearing that owned sample after hash
comparison resolved the harness conflict. No production guard or test assertion
was weakened. The committed CI runner uses its existing clean fixture sequence.

The shared native/fetched fixture helper also received the existing focused flight
creation/recipient/feed/detail regression pass. New cases are wired into the
existing combined Auth integration and database-upgrade CI jobs; the
`test:flights:interest` command selects only the interest scenarios locally.
The full historical suite, unrelated invitation races and hosted preview checks
were not run under the MVP focused-test policy.

Hosted Supabase migration/application, preview verification and production release
verification remain separate. No hosted data/accounts/email/settings or production
publishing changes were made; automatic production publishing must stay locked.
Unrelated `AGENTS.md` and `docs/audits/` changes are preserved and excluded.
