# VOLO-199 — Atomic flight cancellation

Implemented against `a9d9822` (merged VOLO-198). VOLO-67 is Done. This is the persistence step of VOLO-48; cancellation confirmation and page wiring remain VOLO-200.

`cancel_flight(uuid)` derives identity from the session and authorizes the actual owner or an active administrator using the authoritative membership row, locked through commit. A missing/foreign flight shares a safe access denial. Direct member writes and anonymous/service-role RPC execution remain denied.

The operation takes the common flight lock before updating requests. It atomically changes pending/accepted requests to `cancelled` and the open flight to `cancelled`. It preserves flight details, audience, request identities, introductory notes, creation dates and terminal request history. Any write failure rolls the entire operation back. Already-cancelled retries confirm without writes or timestamp changes; completed flights return `flight_conflict`.

Closure does not require a complete profile, current requester eligibility or a future departure. An active admin may intervene for an unavailable owner. There is no hard delete, reactivation, message-table query or separate message state. Future VOLO-81 sends must use the same flight lock and reject closed flight/request state.

## Verification

- 36 new pgTAP checks cover owner/admin authorization, forged metadata, disabled/missing membership, RPC privileges, direct-write denial, exact confirmation, history retention, rollback, immutable retries, closed-state acceptance/resubmission, elapsed open flights and completed conflicts.
- 262 existing related pgTAP checks cover request persistence, decisions, withdrawal, interest, editing and creation.
- Nine forced-overlap PostgreSQL races verify cancellation in both orders against acceptance, withdrawal, edits and resubmission, plus duplicate cancellation. Each observes actual lock blocking before allowing the first transaction to commit and verifies final state/history.
- Additive upgrade from VOLO-197 schema preserves owned fictional Auth/member/profile/flight/request/recipient snapshots.
- Generated database types, route type generation, TypeScript, focused ESLint and diff checks verified.
- Independent code review found no actionable issues.

The first regression command included a mistyped edit-test filename; its four valid files passed, then the runner rejected the missing path. The corrected targeted set was rerun. An initial new-test expectation was corrected to match existing submission precedence: closed flights return `flight_unavailable` before request inspection.

All database writes used local fictional resources. The full suite and hosted authenticated tests were not run under the MVP targeted-test policy. No hosted migration, account/email/settings change or production publication was performed. Netlify Deploy Preview verification is separate and pending after PR creation; production publishing remains locked.
