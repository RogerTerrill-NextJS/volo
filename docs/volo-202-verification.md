# VOLO-202 — Accepted connection view

Implemented on `31d8aaa` (merged VOLO-201). Both approved pilots can open `/dashboard/connections/[requestId]` from an accepted request on flight detail. Owners enter from their incoming request list; requesters enter from their accepted request status. Links are limited to accepted requests on open flights, including elapsed departures whose approval remains active.

The page shows the flight plan, named departure timezone/offset, aircraft, capacity, notes and permitted counterpart profile fields. It identifies the viewer as posting or joining pilot, reuses existing profile/photo presentation, and links back to the flight and permitted profile. No messaging entry point, connection persistence or new lifecycle state is added.

`getConnectionView` composes VOLO-201's guarded connection read with existing authorized flight/profile queries. It binds flight ID, owner, viewer perspective and counterpart identity, then rechecks approval after profile loading. A revoked relationship discards all loaded details. Missing/inaccessible/closed connections share a neutral outcome; transient failures offer an explicit status check. An optional profile outage preserves the authorized flight view with a profile fallback. The requester status query now projects a validated request UUID only for accepted requests, enabling its entry link without a second source of approval.

## Verification

- 23 targeted unit tests passed across connection composition, connection authorization, own-interest status, incoming requests and flight detail. New composition tests and the accepted request-ID projection were observed failing before implementation.
- 40 real-Auth integration scenarios passed using the existing harness. Three new page scenarios cover both perspectives and entry links, private flight/profile isolation, pending/unrelated/admin/disabled access, withdrawal/cancellation/completion/removal, profile timeout/recovery, malformed provider results and withdrawal during profile loading. Existing connection, cancellation, edit, interest, incoming, decision and withdrawal checks passed in the same run.
- Production fixture builds, installed Next route type generation, TypeScript, focused ESLint and diff checks passed. Independent code review found no actionable issues.
- Browser verification passed for owner and requester entry links, keyboard navigation, correct counterpart/role, flight details/timezone, profile links, and withdrawal removing the entry and making the connection page unavailable without details. At 320px, the document remained 320px wide; the focused profile link had a visible outline and 44px target height.

All writes used owned fictional local resources, which were cleaned up. No schema migration or hosted data/accounts/email/settings change was made. The full suite and SQL concurrency tests were not rerun under the MVP targeted-test policy; the guarded RPC is unchanged. No production publication occurred. Netlify Deploy Preview verification remains separate and pending after PR creation; production publishing stays locked.
