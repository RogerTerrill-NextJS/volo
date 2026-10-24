# VOLO-194 — Owner request controls

Implemented on `feature/volo-194-owner-request-controls`, based on merged VOLO-193
(`aa5c823`). The user requested direct implementation without further design or
plan approval stops.

## Behavior and boundaries

Each pending request in the existing owner-only incoming list has Accept and
Decline controls. The Server Action uses the shared authentication, current
membership, origin, payload-size and input guards. It independently checks actual
flight ownership, then calls VOLO-193's locked `decide_flight_request` RPC once.
An unrelated administrator has no ownership bypass. The database rechecks access,
request/flight binding, eligibility and capacity under its existing locks.

Only UUID flight/request identifiers and an accepted/declined decision are allowed.
Success requires both the exact request identifier and requested decision in the
RPC confirmation. Provider details and unexpected response fields are discarded.
There is no optimistic confirmation, alternate connection store or automatic retry.

Controls disable while saving. Confirmed decisions update the badge, remove the
controls and refresh server data. Full capacity leaves the request pending, blocks
another acceptance and permits decline. Stale, denied or uncertain results stop
further decisions until status is checked. Feedback receives keyboard focus and
uses live status/alert semantics. A native GET recovery form reloads current data
and preserves the incoming-list cursor and request fragment, including without
JavaScript. A plain fragment link was found insufficient during browser testing
because it only scrolled within the existing document.

## Verification

- Five new decision unit tests cover strict inputs, actual ownership, response
  binding/projection, safe failure mapping and form state. Initial stubs failed
  these checks before implementation.
- All 22 targeted decision, incoming-query, interest-query/form and mutation-policy
  unit tests passed.
- All 22 focused real-Auth interest/incoming/decision integration scenarios passed.
  Four new decision scenarios cover native/fetched actions, both participant views,
  forged actors/input/origin, wrong-flight request binding, membership revoked
  between application and SQL checks, two stale owner forms, full-capacity decline,
  conflicting decisions, and lost/malformed confirmations with exactly one RPC.
- Route type generation, TypeScript, focused ESLint and diff whitespace checks
  passed. Type generation used fictional loopback environment values.
- Independent code review found no actionable issues, including the final native
  recovery-form and terminal-state refinements.
- Local Chrome checks verified keyboard activation, 44px controls, disabled pending
  controls, focused confirmations, long-note wrapping, stale capacity in separate
  tabs, and decline after capacity was consumed. At 320px document width remained
  320px. The final recovery form fetched Accepted after a discarded confirmation,
  removed decision controls, and left the guarded RPC call count at exactly one.
  Mobile evidence: `/tmp/volo-194-recovered.png`.

The integration harness uses only disposable loopback Auth/PostgreSQL services and
fictional records. No schema change was needed. The full suite and SQL concurrency
suite were not rerun under the project's focused-test policy; VOLO-193 retains the
atomic database/concurrency evidence. Hosted Deploy Preview and production release
verification remain separate and were not performed. No hosted data/settings,
migration application, merge or production publication occurred. Unrelated
`AGENTS.md` and `docs/audits/` changes are excluded.
