# VOLO-226 — Account deletion execution contract

Record Roger's decisions from this chat on 2026-10-26: verified request with founder-admin execution; retain shared history under “Deleted pilot”; 60-day retention for deletion-related audit/report/invitation records and backups. Build a source-grounded executable design for VOLO-227, not destructive application code or a hosted operation. Use the verified request timestamp as the explicit proposed retention clock anchor.

1. Trace current restrictive Auth/member/profile/invitation/shared-record FKs, immutable history, lifecycle locks, Storage cleanup, private reads and session denial.
2. Document authorization, confirmation, access fencing, per-record outcomes, bounded/idempotent external cleanup, 60-day purge/backup obligations, failures/retries and required VOLO-227 proofs. Separate user-approved policy from builder recommendations and unverified provider capabilities.
3. Independently review the contract against actual sources; validate local Markdown links/source references and diff. Commit/push/create a documentation PR. No SQL/Auth/Storage mutations, migrations, email, deployment or invented legal guarantee. No application tests for documentation-only work.

Review focus: shared history survives without identity leakage or broader participant access; disable is not deletion; restrictive FKs and immutable triggers need explicit migrations; Storage cleanup retains its parent until acknowledgement; retries/failures cannot reactivate or claim premature completion; 60-day policy includes backups/provider evidence without erasing other users' records or pretending shared free text is anonymous.
