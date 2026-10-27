# Database recovery before beta

VOLO-112 rehearses an exact-migration rebuild followed by logical data restore into two owned disposable local Supabase projects. It does not authorize a hosted restore or production cutover. See [rehearsal evidence](volo-112-verification.md) and the separate [frontend release/rollback procedure](release-workflow.md).

## Supported paths and the path rehearsed

Supabase documents [logical roles/schema/data backup and restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore). The CLI data dump uses COPY; transactional import can suppress triggers for that import connection. Custom Auth/Storage hooks and policies require separate recreation. Preserve migration history and managed configuration when choosing a full schema restore.

This rehearsal instead rebuilds the target from the **same checked-in migrations and pinned runtime**. Roles/schema dumps are reference artifacts, not imported or certified as a standalone recovery. Before importing data, a catalog manifest must match: schema, columns, constraints, indexes, enums, roles, privileges, RLS, policies, function bodies, application/Storage hooks, extensions, Realtime publication, migration history and inactive schedules. Abort on drift. A matching migration version list alone is insufficient.

[Managed database backups](https://supabase.com/docs/guides/platform/backups), [downloaded-backup local restoration](https://supabase.com/docs/guides/local-development/restoring-downloaded-backup), and [restoration into a new hosted project](https://supabase.com/docs/guides/platform/clone-project) are separate provider paths. Their availability, permissions, retention, compatible images and project-specific requirements must be verified when selecting a hosted recovery operation. None was exercised here; this is not physical/PITR certification.

## Repeat the fictional rehearsal

Requirements: installed dependencies, the pinned Supabase CLI, Docker running, available local ports and the repository's supported Node runtime. The runner creates distinct generated source and target projects, checks their local URLs, ownership registries and Docker labels, and refuses arbitrary source/destination input.

```sh
node scripts/verify-auth-integration.mjs --recovery
```

The runner seeds fictional records and local Auth accounts, pauses jobs, and captures private roles/schema/data dumps plus a separate file-backend Storage snapshot. It hashes every copied table, changes the source after backup, creates the fresh target, compares schema manifests, then imports data in one transaction with `ON_ERROR_STOP` and connection-local replica trigger mode. It audits restored application foreign keys and verifies ordinary trigger mode on a subsequent connection.

The smoke uses fresh restored Auth credentials against the compiled app: metrics, outcomes, current photo bytes, disabled-member denial and unrelated-admin private-data denial. A disabled account is not a deleted-account reconciliation test. The sanitized summary is ignored at `.superpowers/sdd/2026-10-07-volo-119-auth-integration/recovery-summary.json`.

On success, the runner removes private artifacts and destroys both owned stacks. Cleanup attempts all resources even if app shutdown fails. On incomplete cleanup it retains private artifacts and reports their directory. Retry registered project cleanup with:

```sh
node scripts/verify-auth-integration.mjs --cleanup --recovery
```

This command only handles registered owned projects; it does not delete retained backup directories. Inspect the reported task-owned directory before removing it. Never delete another local Supabase project to resolve a port conflict.

## Storage is a separate recovery surface

Database backups contain Storage metadata, **not object bytes**. The rehearsal first proves that restored metadata cannot serve the photo, then restores file bytes and extended attributes separately. The pinned local backend uses `fs-xattr`; its BusyBox archive tool and `docker cp` do not preserve the required MIME attributes. The fixture snapshots bytes and all file attributes through the backend's own installed library, then checks PNG/WebP hashes, WebP MIME type and the actual app photo response. It does not change product validation or Storage policies.

This private file snapshot is specific to the pinned disposable file backend. It is **not a demonstrated hosted Storage/S3 recovery method**. A hosted plan needs an independently recoverable object copy, object versions/metadata/content types, bucket configuration/policies, and a database-consistent recovery point. Verify the real app reads, not just bucket listings or byte hashes.

## Hosted recovery gates before reopening service

A separately approved operation must name the source/target, operator, recovery point, exact migration/runtime revision, affected data, isolation and rollback/cutover decision. Keep access and schedulers quarantined while validating. Do not reset a shared project or redirect a Deploy Preview to a recovered backend as part of this local procedure.

Before beta readiness or any hosted cutover, record:

- Current backup/PITR availability and retention, actual successful backup age, encrypted off-site custody/cadence, restore permissions and a recoverable Storage copy. No such configuration or custody is certified by this local run.
- Agreed RPO (acceptable data loss) and RTO (acceptable outage). The local elapsed time excludes cleanup and is not a production target.
- Auth/provider settings, SMTP/OAuth, redirect allowlists, secrets, Vault/root encryption material and session/recovery-authority invalidation. Fresh fixture sign-in does not certify old-session fencing or key recovery.
- Post-backup deletion/disable/moderation reconciliation from an independent authoritative record. An old backup must not readmit a deleted pilot, resurrect removed personal photos or reset `purge_due_at`. The approved deletion-related audit/report/invitation/backup retention period is **60 days**; verify actual provider expiry, retained copies and overlapping snapshots against it.
- Scheduler and deletion readiness: the rehearsal keeps all three jobs inactive and `deletion_private.policy.retention_verified=false`. It does not demonstrate disabling a restored true gate, post-backup deletion tombstone replay, or safe resumption. Reconcile first; enabling jobs is a separate approval.
- Restored data/foreign keys, grants/RLS/hooks, Auth and real app/Storage reads; a database connection alone is insufficient. Record unresolved failures and the explicit reopen decision.

A new backend URL or public build-time key requires the corresponding frontend build, Auth allowlist review and separate release verification. Keep Netlify production publishing locked. Preview evidence and production release evidence remain separate.
