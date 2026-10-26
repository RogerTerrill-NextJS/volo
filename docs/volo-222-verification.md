# VOLO-222 — Authorized notification destinations

Base: merged VOLO-221 (`f692c76`). Notification rows now expose event-specific links through a protected, read-only recipient lookup. The lookup reads only the current session's notification and typed source reference, validates source bindings and UUIDs, rechecks identity/access, and constructs one of three fixed internal destinations:

- Request received: the existing flight detail Incoming requests section.
- Request accepted: the existing flight connection page.
- Message received: the existing conversation page.

Those pages retain their current authorization and closed-history rules. Historical acceptance does not grant an active connection after withdrawal/resubmission; retained conversation history does not restore sending rights. Missing/foreign records share a safe unavailable state, and service errors offer retry/back navigation. No caller URL, service-role read, copied source content, new counter, schema change or implicit mark-read was introduced. Links disable prefetch; the existing notification private-cache path policy covers the resolver.

## Verification

- Destination tests failed before implementation, then **13 focused target/query/cache unit checks passed**. Cases cover every mapping, foreign/missing notifications and sources, malformed event/source shapes and UUIDs, fixed internal URLs, provider errors and identity revocation/switching during lookup.
- One fresh independent read-only review found no actionable defects and independently reran the five new target tests successfully.
- The added signed-in scenario passed all three permitted redirects and existing destination rendering, foreign/admin denial, source-read outage handling, a stale acceptance leading to the existing Connection unavailable state, and unchanged original notification records/read markers.
- Route generation, TypeScript, focused ESLint and whitespace checks passed.

**All 60 existing signed-in integration scenarios passed**, including the new navigation contract. Styled local browser verification followed a request notification to its authorized Incoming requests section, returned to confirm the notification remained unread, and verified the safe unavailable-target screen. Evidence: /tmp/volo-222-notification-link.png, /tmp/volo-222-notification-destination.png and /tmp/volo-222-notification-unavailable.png.

All owned disposable app/database resources and temporary credential/state files were cleaned up successfully.

The full suite and unrelated database/infrastructure matrices were not repeated under the MVP testing policy; this ticket changes no SQL, mutation or grant. CI and Netlify Deploy Preview verification remain separate and pending. No hosted data/accounts/email/settings change or production publication occurred.
