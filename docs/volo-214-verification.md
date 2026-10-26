# VOLO-214 — Member controls and recovery guidance

Base: merged VOLO-213 (`85daeda`). `/admin/members` uses the existing guarded overview and atomic audited disable action. Administrators can inspect membership identity, role/status, dates and recorded reason, paginate by UUID, and disable another active member with a required reason and confirmation. Self-disable, role promotion, deletion and reactivation have no UI controls. Operator recovery is documented in `member-administration-recovery.md`.

The form supports native and hydrated submissions. Confirmed success must match the submitted member; uncertain results freeze submission until an explicit GET checks current status, preserving the page cursor. Feedback is sanitized and focused, pending controls are locked, and membership data stays escaped. No optimistic success or automatic mutation retry is used.

## Verification

- All 10 targeted form/policy unit tests passed, including an independent reviewer's rerun. The new form tests initially failed before implementation.
- All five existing-harness real-session scenarios passed: current-admin overview/action guards; native/fetched page confirmation and safe controls; uncertain recovery, pagination and stale authority; audited disable with retained-session denial and preserved records; ambiguous responses, idempotency and concurrent disables. A test-helper quote decoder initially corrupted hidden native-action metadata; retaining raw HTML fixed the helper, and the entire member-admin subset passed on rerun. Owned fixtures were cleaned up.
- Chrome on an owned local fixture verified literal malicious-looking display text, mandatory reason/confirmation, disabled pending controls, focused confirmed feedback, an actual action-response loss with frozen resubmission, and explicit GET recovery to the saved disabled state/reason. At 320px viewport width the document width remained 320px. The disabled member's retained session returned 403. All owned browser fixture resources were cleaned up.
- Route type generation, TypeScript, focused ESLint and diff checks passed. Independent code review found no actionable defects.

The full suite and unchanged SQL policy matrix were not rerun under the MVP testing policy. No hosted accounts, data, email, settings or production publication changed. VOLO-213's required migration remains unapplied to hosted Supabase; Deploy Preview and production release verification remain separate and are not claimed here.
