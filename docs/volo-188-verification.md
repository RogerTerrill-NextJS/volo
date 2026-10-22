# VOLO-188 — Request schema and initial policies

Implemented on `feature/volo-188-request-schema` from merged VOLO-187
(`36d8226`). Parent: VOLO-63. The user approved withdrawn-to-pending
resubmission on the same record, with fresh eligibility checks, and requested a PR.
Declined and cancelled requests remain terminal. The installed Next.js
data-security guide was read; this change introduces no application endpoint/UI.

## Persistence and transition contract

`flight_requests` stores a generated immutable UUID, restrictive flight/member
foreign keys, an immutable flight/requester pair with a unique constraint, an
optional introductory note of at most 500 characters, and server-managed
`created_at`, `updated_at` and `status_changed_at`. Notes may be replaced only
when resubmitting a withdrawn request. Timestamps supplied by a caller are ignored.

| Previous state | Permitted next states |
| --- | --- |
| New record | pending |
| pending | accepted, declined, withdrawn, cancelled |
| accepted | cancelled |
| withdrawn | pending |
| declined, cancelled | No other state |

Same-state updates preserve `status_changed_at`. Resubmission keeps the UUID and
creation timestamp; it does not create duplicate history rows. Accepted withdrawal
is deliberately closed until VOLO-67 obtains its separate product decision.
This ticket does not decide material edits, independent messaging or account deletion.

New interest, resubmission and acceptance reject self-requests, missing flights,
inactive owners/requesters, incomplete requester profiles, past/non-open flights
and missing PRIVATE selection. The trigger acquires the flight lock and acceptance
checks capacity against accepted rows. Remaining capacity is derived, never stored.
Terminal cancellation remains possible after departure, disablement or loss of
selection. No hidden-flight column exists yet; moderation must add its eligibility
check when that schema/operation is introduced.

Authenticated members have SELECT only, with current active membership and either
the requester relationship or actual flight ownership. Unrelated administrators
have no bypass. A removed recipient can read their prior request while active,
without live PRIVATE-flight access through an embedded/joined flight relationship.
No new definer read helper or privileged application client is required.

Member inserts/updates/deletes remain closed. VOLO-64/66/67 must introduce guarded
identity-derived submission, owner decision and requester withdrawal RPCs. Runtime
operations must lock the flight **before** updating request rows and independently
check actor authorization; the persistence trigger is not a caller authorization
API. Acceptance and resubmission repeat current eligibility checks in SQL. The
schema permits pending interest at full capacity, but no member submission endpoint
is exposed; VOLO-64 must settle full-flight submission behavior before exposure.

## Recipient-removal integration

The VOLO-179 request-table fence is replaced with real request cancellation.
`change_flight_recipient` retains its active-owner check, signature and grants.
While holding the common flight lock, removal cancels pending/accepted requests
then removes selection in one transaction. Already terminal states remain intact.
Accepted-to-cancelled releases derived capacity once; retries are idempotent.
Re-adding a selection never revives a cancelled request.

The future conversation-table fence remains. Its owning migration must implement
atomic sending closure before allowing removal when conversations exist. No empty
conversation schema or speculative closure implementation is introduced.

## Verification

| Check | Result |
| --- | --- |
| Initial request-persistence assertion before implementation | Failed because table was absent |
| Requests, recipients, flight schema/creation, memberships, profiles | 287 pgTAP assertions passed with seeds; 287 without seeds |
| Concurrent duplicate insertion | Observed lock wait; exactly one record, second rejected with 23505 |
| Request creation before recipient removal | Observed lock wait; removal cancelled committed request and revoked selection |
| Recipient removal before request creation | Observed lock wait; creation rejected, no request/selection remained |
| Two acceptances competing for one place | Observed flight lock wait; one accepted, second rejected with 23514 |
| Additive prior-schema upgrade | Existing fictional Auth/member/profile/flight/recipient record hashes unchanged |
| Clean migration rebuild without seeds | Passed |
| Actual public type introspection and drift check | Passed |
| Next route type generation, TypeScript, focused ESLint, diff check | Passed |
| Independent static review | No actionable findings |

SQL covers self/ineligible/unavailable/private denial, initial and legal states,
resubmission and note replacement, uniqueness, immutable identity, timestamp
ownership, restrictive deletion, participant/admin/anonymous/direct-write isolation,
retained-session disablement, history/live-flight separation, pending and accepted
removal, disabled-target cancellation, released capacity, re-add and conversation
fence rollback. Existing recipient tests retain no-request removal and the future
conversation fence; their obsolete request placeholder table was removed.

Concurrency cases reuse the existing upgrade verifier's owned local SQL/session
barriers, run against real PostgreSQL 17, and are included in database CI. Local
verification invoked those same helpers without running unrelated invitation races.
The full historical suite and hosted Netlify preview were not run under the MVP
focused-test policy. The initial route typegen attempt lacked required environment
configuration; rerunning with the existing offline CI values passed.

No hosted Supabase changes, accounts/email/settings changes, release or production
publication occurred. Netlify previews share production Supabase, so this unapplied
migration is verified locally; preview verification and production migration/release
verification remain separate. Automatic production publishing must stay locked.
Unrelated `AGENTS.md` and `docs/audits/` changes are preserved and excluded.
