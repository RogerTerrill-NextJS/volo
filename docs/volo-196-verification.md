# VOLO-196 — Requester withdrawal controls

Implemented on `feature/volo-196-withdrawal-controls`, based on merged VOLO-195
(`7a520ee`). Uses the approved pending/accepted withdrawal and eligible same-record
resubmission policy recorded in `docs/volo-195-verification.md` and parent VOLO-67.

## Behavior and boundaries

The existing Join this flight form shows Withdraw request only for the current
pilot's pending/accepted request. The accepted view explains that withdrawal frees
the place and resubmission requires fresh owner approval. Flight owners, unrelated
pilots and terminal requests receive no withdrawal control. Missing profile data
does not prevent withdrawal of an existing request.

The existing Server Action dispatches the explicit `intent=withdraw` form through
the shared current authentication/membership, origin, payload-size and strict-input
guards. It accepts only the flight UUID and withdrawal intent. The request UUID is
derived from a session-scoped flight/requester-filtered read, whose flight, actor
and UUID are validated before invoking VOLO-195's locked RPC once. Request UUID,
owner/requester identity, status, note and timestamps supplied by a caller are
rejected. The RPC independently rechecks actor and binding under its flight lock.
Neither an administrator role nor profile completeness grants extra access.

Only an exact request UUID/withdrawn-state confirmation is projected, with the
bound flight UUID for form-state validation. Unexpected or provider-specific fields
are discarded. Confirmed withdrawal refreshes server data, focuses feedback and
shows eligible resubmission in the same form state. Resubmission returns pending
and re-exposes withdrawal, retaining the same database request record. Existing
flight/profile restrictions continue to suppress unavailable resubmission controls.

While saving, the fieldset disables and announces withdrawal progress. Stale,
denied and uncertain outcomes suppress further actions until a native GET status
reload. No optimistic cancellation, automatic retry or separate state store is
introduced. Native and hydrated submissions share the same operation and feedback.
The status recovery control also replaces the existing interest fragment-sensitive
link with a GET form to guarantee a fresh document request.

## Verification

- Five new unit tests first failed against stubs, then passed. They cover strict
  input, actor-derived request identity, no profile prerequisite, exact confirmation
  binding, fixed safe failures and blocked uncertain/stale feedback.
- All 21 targeted withdrawal, interest form/query, owner-decision and mutation-policy
  unit tests passed. TypeScript, route generation, focused ESLint and diff checks
  passed; route generation used fictional loopback environment values.
- All 26 focused real-Auth interest/incoming/decision/withdrawal scenarios passed.
  Four new scenarios exercise native pending and fetched accepted withdrawal,
  owner/requester view updates, retained history and same-record resubmission,
  hidden controls for other users, forged identity/state/input, origin rejection,
  disablement between lookup and RPC, missing profile, terminal conflicts,
  immutable matching retries, and lost/malformed confirmations without retries.
- Integration assertions distinguish native HTML from the JavaScript response's
  React component payload. Native rendering and reloaded requester HTML verify the
  resubmission controls; the fetched result verifies withdrawn state/resubmit mode.
  Missing-profile setup uses the existing owned-profile SQL helper because service
  API profile deletion is intentionally denied. One existing incoming scenario had
  a transient transport failure; it passed in the complete rerun without product
  changes. Safe exception-type context is retained in the scenario wrapper.
- Local Chrome verified accepted withdrawal by keyboard, a 2px focus outline,
  disabled progress control, focused confirmation, immediate resubmission and
  return to pending. At 320px the withdrawal control was 50px tall and document width
  remained 320px. Discarding a committed response showed the uncertainty alert,
  suppressed actions and recovered withdrawn state via the native status form;
  guarded RPC calls increased by exactly one. Evidence: `/tmp/volo-196-withdrawal.png`.
- Independent code review found no actionable issues.

All writes used fictional records in owned disposable loopback services, with
exact fixture cleanup. No schema change was needed. The full suite and SQL
concurrency suite were not rerun under the focused-test policy; VOLO-195 records
the atomic database/concurrency evidence. Hosted preview and production release
verification remain separate and were not performed. No hosted migration/data/
account/email/settings changes, merge or production publication occurred.
Unrelated `AGENTS.md` and `docs/audits/` changes remain excluded.
