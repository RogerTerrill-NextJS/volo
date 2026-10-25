# VOLO-213 guarded member administration

Scope: VOLO-85 step 1, based on merged VOLO-212 (`4add713`). VOLO-214 owns UI controls and operator recovery guidance. Existing membership checks remain the access authority; no Auth deletion, role promotion, reactivation or session-token mutation is added.

Use ordinary authenticated sessions and restricted database RPCs. An active admin can read a bounded, cursor-paged overview containing membership UUID, display name, role/status, creation/disable time and a bounded reason excerpt with a truncation flag. Exclude account emails, Auth metadata and credentials. Recheck administrator identity at the application boundary after the read. Existing schema-valid operator reasons and timestamps must remain readable even when they differ from new-write validation.

Disable accepts only target UUID and a required 1–500-character reason plus explicit confirmation at the action boundary. Derive actor/time/action in SQL, update membership and insert an immutable audit row in the same transaction. Lock actor and target rows in UUID order; deny self-disable and recheck current active admin under lock. Other admins can be disabled, but concurrent cross-disables cannot remove both admins. Repeating a confirmed disable preserves the original reason/time and adds no audit event. Audit insert failure must roll back membership change. Service-role/direct member writes cannot use the new operation. Disable retains existing profiles/flights/messages and immediately fails subsequent protected checks using retained sessions.

- [x] Add focused SQL checks and application policy/query unit tests before implementation.
- [x] Implement additive audit table/RLS and overview/disable RPCs, generate database types from an owned disposable stack. Add server-only input/policy/query/action modules using the existing guard and ordinary session client.
- [x] Extend existing real Auth app fixture and runner with member-admin cases (no second Auth harness). Verify native/fetched actions, current non-admin/disabled denial, stale session/data access, server-derived audit and idempotency, guarded overview pagination, failure sanitization and no collateral deletion. Run affected SQL/unit/integration/type/lint/boundary checks.
- [x] Independent review, verification notes, commit/push and requested PR. No hosted migration, account/data/email/settings changes or production release; deployment preview cannot use the new migration until separately approved.

Review focus: actor cannot be spoofed; audit atomicity/immutability; ordinary users cannot read admin overview/reasons/audit or invoke disable; stale admin roles/status must fail under locks; self/cross-disable safety; existing target sessions lose data/action access; no accidental Auth or retained-history deletion; confirmed/uncertain response handling cannot claim unverified success.

Completed with 109 affected SQL checks, 31 targeted unit/infrastructure checks and three real-session scenarios. Integration/review compatibility findings for legacy disable metadata were corrected with regression coverage. See `docs/volo-213-verification.md`.
