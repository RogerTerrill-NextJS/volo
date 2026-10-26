# VOLO-223 — Privacy-safe MVP metrics

Base: merged VOLO-222 (`23a9ea9`). One no-argument `admin_mvp_metrics` query and the protected admin report derive eleven aggregate counts from existing records. Current active-admin membership is locked through the report transaction; no anonymous/service-role execution or member/admin-metadata bypass exists. One SELECT snapshot returns no user IDs, emails, profile fields, aircraft/routes, notes, reasons or message bodies. Source-table grants and policies remain unchanged.

Definitions are shown beside the report counts:

- Invited pilots: distinct normalized recipients with an accepted or reconciled-accepted provider send receipt. Retries, resends and repeated invitations do not inflate this count; provider acceptance does not prove delivery.
- Activated pilots: distinct redeemed invitation subjects. Bootstrap/direct admissions are excluded; currently active memberships are a separate gauge.
- Complete/active profiles: all retained schema-complete rows versus those belonging to currently active members.
- Flight posts and interest requests: retained unique records, including private/hidden/closed history. Eligible resubmission reuses its request record.
- Current accepted requests versus recorded acceptance: current state is separate from distinct requests with current acceptance, an acceptance notification or conversation evidence. Reacceptance counts once. Earlier closed requests lacking evidence cannot be reconstructed.
- Messages and messaging conversations: immutable message records and distinct conversations with at least one message, including closed history.

Real-world flying outcomes are explicitly `not_collected`; acceptance and messaging are not proof that pilots flew together. VOLO-96 owns the separately identified participant-confirmation/outcome verification. There is no new event store, tracking SDK, warehouse, paid service, client browsing instrumentation, cohort/filter engine or conversion-rate claim.

## Verification

- The aggregate contract failed on the merged baseline, then **57 targeted SQL checks passed** across metrics and existing member administration. Fixtures cover failed/reconciled/repeated invitation recipients, redemption, active/disabled profiles, private posts, same-record resubmission/reacceptance, message retry deduplication, retained acceptance history, raw-message isolation, forged metadata, unadmitted/disabled identities, demoted admins and closed anonymous/service execution.
- **Five query/cache unit checks and 21 infrastructure/upgrade-guard checks passed.** DTO checks reject malformed/private payload fields, unsafe counts and invented confirmation states; final role/identity checks discard data after access changes.
- **Eight signed-in integration scenarios passed** using the existing report/request/message fixture: one metrics scenario verifies exact aggregate populations, private response headers/content, member/disabled/unadmitted/demoted-admin denial, direct RPC restrictions, outage/recovery and retained raw-message isolation. Seven existing report/support scenarios remained green.
- Public types were generated from the owned migrated database. Route generation, TypeScript, focused ESLint and whitespace checks passed. The existing upgrade migration allowlists include the new migration.
- Independent read-only review found no actionable defects and independently reran all five unit/cache checks successfully. Parent verification covers the SQL and signed-in results; no separate database concurrency harness was added.
- Styled local browser verification confirmed the admin navigation, count definitions, separate uncollected-outcome explanation and fresh snapshot after reload. Evidence: /tmp/volo-223-metrics.png and /tmp/volo-223-metrics-outcomes.png.

All owned disposable database/app resources and temporary credential/state files were cleaned up successfully.

The full suite, destructive prior-schema upgrade, production-scale benchmark and full accessibility audit were not run under the MVP scope. Report scans are intended for the small MVP dataset; performance at production scale is unbenchmarked. CI/Netlify Deploy Preview and production verification remain separate. No hosted migration/data/account/email/settings operation or production publication occurred.
