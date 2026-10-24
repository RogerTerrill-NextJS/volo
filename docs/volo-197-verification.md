# VOLO-197 — Owner edit and capacity invariants

Implemented on `feature/volo-197-flight-edit-invariants`, based on merged VOLO-196
(`0a9bb79`). The founder explicitly chose **cancellation and reposting**, rather
than participant reconfirmation, for material changes with accepted pilots. This
resolves the parent VOLO-47 decision. VOLO-198 owns the application edit form and
material-change guidance; this ticket supplies the guarded database operation.

## Approved behavior

For an open, upcoming flight, the current active, licensed actual owner may edit
airports, departure instant/timezone, aircraft description, capacity and notes.
An unrelated administrator has no bypass. With any currently accepted request,
airport, instant, timezone or aircraft changes return `repost_required` without
changing the flight or its requests. The owner must cancel and create a new flight
through the relevant lifecycle operations; editing does not cancel/repost silently.
With no currently accepted pilots, those material edits are allowed, including
when pending or withdrawn request history exists. Acceptance remains explicit.

Notes and capacity may change with accepted pilots, but joining-pilot capacity
cannot fall below the accepted count. Disabled accepted pilots still count until
their accepted state is closed through an authorized operation. Flight identity,
owner, creation time, visibility, recipient selection and status are outside this
edit RPC. In particular, edits cannot bypass audience removal/cancellation rules.

## Transaction and response contract

`edit_flight(uuid,timestamptz,text,text,timestamptz,text,text,integer,text)` takes the
expected `updated_at` revision and all editable content. It derives the actor from
`auth.uid()`, locks active membership/profile eligibility, then takes the common
flight lock before reading revision and accepted count. Acceptance, withdrawal,
submission and recipient removal serialize on that same flight lock.

An identical payload returns `already_updated` without writes, even with its
original stale revision after a lost response. A different stale payload returns
`flight_conflict`. A capacity violation returns `capacity_conflict`; a closed/past
flight returns `flight_unavailable`. Successful `updated`/`already_updated` results
contain only flight UUID and revision. Missing/foreign flights share owner denial
(`42501`); invalid inputs use `22023`. Anonymous/service-role execute grants and
direct member table writes remain closed. Named timezone/content constraints and
server-derived departure-local date remain enforced.

The persistence trigger independently rejects material changes with accepted
pilots and capacity reductions below accepted count, including privileged direct
updates. It preserves original creation/owner rules and advances `updated_at`
monotonically using database clock time or the prior revision plus one microsecond.
Future application code must round-trip the full database revision string rather
than truncating it to JavaScript milliseconds.

## Verification

- New pgTAP test first failed because `edit_flight` did not exist.
- Final related SQL run: **392 assertions passed across eight files**, covering edit,
  flight persistence/visibility, creation, request persistence/submission, owner
  decisions, withdrawal and recipient rules. New edit cases cover authorization,
  privileges, material fields, capacity floor, stale/no-op complete-record
  preservation, unchanged participant history, privacy boundaries, input checks,
  local-date derivation, closed/past flights and direct privileged bypass rejection.
- **Eight observed lock-contention cases passed**: both material-edit/acceptance
  orders, both capacity-reduction/acceptance orders, both withdrawal/capacity-edit
  orders, and identical/different concurrent edits from one revision. Checks assert
  safe results, capacity, preserved audience/identity/notes and winner snapshots.
  These reuse the existing upgrade verifier's sessions and `pg_blocking_pids` barrier.
- Additive upgrade from `20261024010000` preserved the complete fictional Auth/member/
  profile/flight/request/recipient snapshot, including an accepted request. Both
  explicit migration-history allowlists include the new migration.
- Public types were generated from owned PostgreSQL 17 and drift-checked after the
  upgrade. Route generation, TypeScript, focused ESLint and diff checks passed.
- Independent review found no production issues. Its timing-fixture concern was
  addressed: existing departure tests now allow five seconds for acceptance setup
  and wait until the recorded departure plus 50ms, preserving their original past-
  departure assertions without illegally rewriting an accepted plan.

All writes used owned local/disposable resources and exact fixture cleanup. No UI
change requires browser verification in this ticket. The full suite, real-Auth app
integration and unrelated upgrade races were not rerun under the focused-test policy.
Hosted preview and production release verification remain separate and were not
performed. No hosted migration/data/account/email/settings changes, merge or
production publication occurred. Unrelated `AGENTS.md` and `docs/audits/` edits are
preserved and excluded.
