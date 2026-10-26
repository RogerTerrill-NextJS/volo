# Member administration: status checks and operator recovery

The Members page is available only to a current active administrator. It shows membership UUIDs alongside display names because names are not unique. Verify the UUID, account context and intended target before supplying a reason and confirming Disable member. Self-disable is blocked. Disabling another administrator removes that administrator's protected access as well.

Disabling changes application membership, not Auth identity. Existing sessions cannot authorize subsequent protected requests or mutations, but the account and retained profiles/flights/messages remain. It does not cancel flights, release request capacity, delete records, change roles or revoke every Auth token. Account deletion is a separate operation governed by VOLO-91.

## If the result is uncertain

1. Do not repeatedly submit, change the target, or assume an error means no change occurred. The operation may have committed before its response was lost.
2. Use **Check member status**. This performs a fresh GET and preserves the current member page. If the member is Disabled, the operation is confirmed by current server state; the stored disable time/reason are authoritative. If still Active, reverify the target and deliberately enter/confirm a new attempt.
3. An active admin can inspect `member_admin_audit` through the ordinary authenticated session. Match `target_id`, `action = member_disabled`, actor, timestamp and reason. A repeated disable of an already-disabled membership preserves the original metadata and adds no new audit event. Never rewrite or delete an audit record to reconcile a response.
4. An unavailable overview provides no controls. Retry the status check after the access/database service recovers. Missing admission or admin authority must be resolved through the established operator process; cached page controls do not grant permission.

The page displays reason excerpts of up to 500 characters and marks truncation. An authorized operator can inspect the full persisted membership/audit record when needed. Older whitespace-only text may have no visible reason; it does not imply that the account is active.

## If a disable was mistaken

Reactivation is deliberately absent from the UI and public admin RPCs. It requires a separately approved, targeted operator operation in the intended environment. PR Deploy Previews share production Supabase, so they are not a disposable place to practice recovery. Use owned local fixtures for rehearsals.

Before an approved operation, record the operator, target UUID, reason, environment and approval in the operational record. Check that the membership exists, is Disabled and has the expected existing role. Preserve its original disable audit event and all retained data.

Within one operator-controlled transaction, lock that exact membership UUID, recheck its disabled status, and change only `status` to `active`, `disabled_at` to null and `disabled_reason` to null. Require exactly one affected row; otherwise roll back and investigate. Leave `role` and `created_at` unchanged. Do not create another membership, promote a role, delete an Auth user or edit old audit rows as a recovery shortcut.

After commit, verify current membership with a fresh protected request using the recovered account and check that another current active admin can still use the Members page. Prior flight cancellations, withdrawals or PRIVATE recipient removals are not reversed by reactivation; any relationship needing fresh approval must follow its normal flow. Record completion separately from any production release. Recovering admission for an administrator disabled outside these controls uses the same separately approved operator process, not browser metadata or role promotion.
