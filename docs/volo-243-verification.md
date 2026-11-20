# VOLO-243 verification — 19 November 2026

## Scope
Use existing profile display names as the primary identity on the admin Members page. Move named members' IDs into a closed Member details disclosure; keep an explicit no-profile fallback. Use the name in the disable form's accessible legend. Hidden action targets, card keys, pagination cursors, membership permissions and audit records continue to use the unique member ID.

## Database assessment
The existing admin_member_overview RPC already left-joins memberships to profiles and returns displayName under current active-admin checks. No schema, query, generated-type, RLS or data migration is required. Members without profiles must still appear.

## Evidence
- Existing member-admin and form-state unit tests: 10 passed.
- Integration regression reproduced the original prominent UUID field before the change.
- Independent review identified the need to distinguish same-name members before taking administrative action; the implementation retains IDs on demand rather than exposing them prominently.
- Added same-name identification regression failed before the disclosure was implemented, then passed with the fix. A JSX comment boundary in the accessible-legend assertion was handled by comparing text with HTML comments removed.
- All 23 scenarios in the existing member-administration integration command passed against disposable local Auth/Postgres, including the five member-administration scenarios plus the command’s related moderation/report/outcome checks.
- Confirmed named-member ID fields are collapsed by default, malicious names render escaped, disable controls use names, duplicate names retain separate hidden targets, members without profiles remain identifiable, paging is preserved, and unauthorized/currently revoked accounts cannot use controls.
- Final typecheck (with non-secret configuration placeholders), changed-file ESLint and git diff --check passed. The full test suite was not run, following the targeted-test policy.
- Disposable integration stacks were cleaned up by the verification command. No hosted database or production data was modified.

## Delivery
Branch: feature/volo-243-member-names. No production data changed. Deploy Preview/manual browser verification and production release verification are separate and are not established by local tests.
