# VOLO-201 — Derived authorized connections

Implemented on `e94b43c` (merged VOLO-200). This is VOLO-70's read/authorization layer; the accepted connection screen belongs to VOLO-202 and closed-history presentation to VOLO-203.

`get_flight_connection(request UUID)` derives the owner/requester relationship from the existing accepted `flight_requests` record and its flight. It returns only request, flight, owner and requester UUIDs. The viewer must be one of those two pilots, both memberships must currently be active, the flight must remain open, and a PRIVATE requester must remain selected. Pending, unrelated and unrelated-admin callers get no connection. Missing, closed and ineligible relationships share a null result. Anonymous and service-role execution are revoked.

An elapsed departure alone does not erase accepted approval. Profile completeness is a posting/requesting requirement, not an additional connection-read gate. Withdrawal, cancellation and PRIVATE removal consume their existing authoritative request/flight transitions; resubmission requires fresh owner acceptance. Retained request history remains under its existing separate policies and never grants current PRIVATE-flight access.

The server-only `getFlightConnection` query uses the ordinary session RPC, validates the bound UUID/pair, adds the viewer's counterpart and owner perspective, and discards provider extras. It rechecks the derived relationship and current viewer before returning. No connection table, duplicate state machine, write, contact data or messaging permission is created. This read is a snapshot; future sends must perform their own serialized current-state authorization under VOLO-81.

## Verification

- 31 new pgTAP checks passed for participant authorization, pending/unrelated/admin denial, current memberships/PRIVATE selection, profile independence, past versus completed flight state, withdrawal/resubmission/reapproval, cancellation/removal and unchanged request history.
- 214 targeted database checks passed across connections, request persistence, decisions, withdrawal and cancellation. The 31 connection checks also passed after the additive upgrade.
- 20 targeted query unit tests passed, including three new tests observed failing against a stub before implementation. They cover exact binding/projection, malformed data, access changes and closure between reads.
- Additive upgrade from VOLO-199 schema preserved owned fictional Auth/member/profile/flight/request/recipient snapshots. Generated RPC types match the upgraded schema.
- Installed Next route type generation, TypeScript, focused ESLint and diff checks passed. Independent review found no remaining actionable issues.
- 37 real-Auth integration scenarios passed through the existing harness, including three new connection scenarios: exact approved-pair projection, direct RPC/pending/admin denial, current membership and PRIVATE selection, withdrawal/resubmission/reapproval, cancellation/removal, mid-read closure/revocation and sanitized malformed provider results. Existing cancellation, edit, incoming, interest, decision and withdrawal regressions passed in the same run.

The first integration run found a fixture capacity error: the accepted pilot filled its single place before the test attempted a second pending request. The fixture now provides two places; production capacity enforcement was unchanged. The corrected complete run passed, and local resources were cleaned up.

All writes use owned fictional local resources. No hosted migration, data/accounts/email/settings changes or production release were performed. The full suite is not run under the MVP targeted-test policy. No new browser screen is introduced by this subtask. Netlify Deploy Preview verification remains separate and pending after PR creation; production publishing stays locked.
