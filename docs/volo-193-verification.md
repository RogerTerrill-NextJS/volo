# VOLO-193 — Atomic owner acceptance and decline

Implemented on `feature/volo-193-owner-request-decisions` from merged VOLO-192
(`4018fab`). Parent: VOLO-66. The user approved the single-RPC design and
implementation plan, inline execution and PR creation. VOLO-194 owns application
action/UI wiring; this ticket introduces the database operation and its public types.

## Contract

`decide_flight_request(uuid,uuid,text)` derives the actor from `auth.uid()` and
requires current active membership and actual flight ownership. Unrelated admins
have no bypass. Missing/foreign flights share authorization denial. Both request
UUID and flight UUID must bind to the same record before any result or mutation.
Only accepted/declined decisions are supported; malformed inputs are rejected.

The fixed-empty-search-path definer function is executable only by authenticated
callers. Anonymous and service-role execute grants are revoked. Direct member
table writes remain closed. The existing request trigger still independently
checks legal transitions, eligibility and capacity and manages timestamps.

After the common flight lock, the function locks the bound request. Pending
acceptance rechecks open/future flight, active requester, complete licensed profile,
PRIVATE selection and remaining capacity under that lock. A full flight produces
`capacity_full` without changing the pending request. Decline is terminal closure
by an active owner, including after departure, flight closure or target disablement.

Successful decisions return `decided` with request UUID and accepted/declined state.
A matching retry returns `already_decided` without updating anything, even after
acceptance eligibility has expired. Opposing or withdrawn/cancelled decisions
return `request_conflict`. Unknown/mismatched requests return `request_unavailable`;
failed acceptance eligibility returns `request_ineligible`. Failure results reveal
no requester details, other accepted requests or capacity counts. A trigger-level
check failure rolls back the attempted update and returns bounded ineligibility,
including when departure passes between the RPC and trigger checks.

## Verification

| Check | Result |
| --- | --- |
| New decision pgTAP test before migration | Expected failure: RPC absent |
| Decision/request/submission/recipient pgTAP | 182 assertions passed across four files |
| Authenticated decision concurrency | Six observed lock-contention scenarios passed |
| Additive prior-schema upgrade | Existing fictional records unchanged |
| Public database type generation and drift check | Passed |
| Next route type generation, TypeScript, focused ESLint and diff checks | Passed |
| Independent whole-branch security/concurrency review | No actionable findings |

SQL tests cover function privileges/search path, absent/spoofed/disabled actors,
unrelated admins/requesters, wrong-flight request binding, input rejection, all
five states, matching retries, conflicting decisions, identity/creation/note
preservation, pending capacity loser, unavailable flight/profile/PRIVATE selection,
disabled requester, permitted terminal decline and closed direct updates.

The existing upgrade verifier's SQL/session/barrier machinery observes
`pg_blocking_pids` before releasing the first transaction. The new helper exercises
the authenticated RPC for both approvals, rather than privileged status updates:

- Two pending approvals for one place: one `decided`, one `capacity_full`, exactly
  one accepted request and the loser still pending.
- Matching same-request retry: `already_decided`, entire first-decided row unchanged.
- Accept then decline, and decline then accept: later decision conflicts and leaves
  the winner's entire record unchanged.
- Accept then PRIVATE removal: removal cancels the accepted request and releases capacity.
- PRIVATE removal then accept: later acceptance conflicts; request remains cancelled.

Every race cleans up its exact fictional rows and sessions. The helper is wired
into the existing database upgrade CI path; no new generic runner is introduced.
Local execution invokes the same helper through a temporary owned-database wrapper.

The additive check rebuilt the owned PostgreSQL 17 database at `20261022020000`,
created fictional Auth/member/profile/flight/request/recipient rows, applied only
the decision migration and compared their complete-record snapshot digest. No
existing record changed. The public RPC types were generated from the resulting
real schema; both explicit upgrade migration allowlists include the new version.

No application UI changes need browser verification here. The full historical
suite, unrelated invitation upgrade races, real-Auth app integration and hosted
preview verification were not run under the MVP focused-test policy. Hosted
preview verification and production release verification remain separate.

No hosted data/settings, migration application, merge or production publication
occurred. Automatic production publishing stays locked. The owned local database
is stopped after verification. Unrelated `AGENTS.md` and `docs/audits/` changes
are preserved and excluded.
