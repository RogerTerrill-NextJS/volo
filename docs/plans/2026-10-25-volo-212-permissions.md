# VOLO-212 cross-feature permission verification plan

Scope: VOLO-212 / VOLO-74, based on merged contact pathway `ab528ac`. Existing acceptance, cancellation and message-policy evidence (VOLO-66/73/81) remains authoritative. No new permission model, Auth stack, production route or schema is planned.

- [x] Audit existing connection/contact/message coverage. Distinct gaps: a selected same-flight pending requester crossing into another accepted request's contact/chat; stale forms obtained from the real contact → chat flow after cancellation/PRIVATE removal/withdrawal; resubmission staying closed until fresh approval reuses that exact conversation.
- [x] Add two behavior scenarios to `tests/helpers/flight-interest-cases.mjs`, reusing its existing accounts, native/fetched page actions, response safety checks and owned local lifecycle operations. Assert positive participant destinations, negative actor results, no private canaries and unchanged persisted request/conversation/message snapshots after denied entry/send attempts.
- [x] Run the affected integration scenarios plus existing connection/contact/chat permission cases through the existing local stack/app harness; run targeted unit and lint checks. Production fixture builds provide route compilation evidence; no application code is expected to change.
- [x] Independent review, concise coverage/evidence document referencing existing state/policy checks, commit and create PR. Preserve unrelated AGENTS.md/docs/audits changes. No hosted data/accounts/email/settings changes or production publication; Deploy Preview verification remains separate.

Review focus: tests must exercise actual application entry points rather than only RPC doubles, distinguish same-flight pending from unrelated users, prove both participant perspectives, retain read-only history without restoring PRIVATE flight access, check stale native/fetched forms and persisted no-mutation snapshots, and avoid duplicating existing Auth or SQL matrices.

Completed: 18 selected real-session scenarios and 27 targeted unit checks passed. Independent review strengthened full-flight snapshots and pending resubmission stale-send assertions; both affected scenarios passed again. No production code changes were needed. Evidence: `docs/volo-212-verification.md`.
