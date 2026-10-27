# Founder account-deletion operations

VOLO-227 implements the [approved policy](account-deletion.md) as a founder-managed server/operator workflow. Pilots contact a founder through their agreed private support channel. Verify ownership separately for inaccessible accounts; a supplied email or UUID alone is not proof. Record only a bounded private verification reference. The app profile editor explains this support path; it has no immediate self-service destructive control.

## Release gate and authority

New execution is **off by default** in `deletion_private.policy`. Before any hosted enablement, obtain the separately authorized migration/operation and record verified database/Auth/Storage/log/email-provider retention and restore evidence for the 60-day deadline. A generic 60-day backup setting is insufficient when a later snapshot can contain still-retained evidence. Do not enable the gate based on local test results. Only a separately approved privileged database operation can set `retention_verified` and its bounded `evidence_reference`; ordinary members, app admins and service-role RPC calls cannot change this private table.

Execute only from a trusted server/operator environment. Configure existing public Supabase variables and `SUPABASE_SECRET_KEY`; provide a current active administrator's access token in `VOLO_DELETION_ADMIN_ACCESS_TOKEN`, never a command-line argument, log, ticket or browser client. Do not ask the departing pilot for a password or token. The script verifies the Auth identity and every database phase checks current active administrator membership. Expired tokens and demoted/disabled operators stop progress; another current admin can resume using the same request ID. Self-execution is denied; deleting the last active administrator is denied. Provisioning another admin is a separate operation.

## Runbook

These are command forms, not authorization to run them on a hosted account. Replace placeholders with verified owned/approved values; the confirmation must exactly equal the subject UUID.

```sh
# Preview the explicit begin arguments; no deletion begins without --execute.
node --conditions=react-server scripts/process-account-deletion.mjs \
  --request REQUEST_UUID --subject SUBJECT_UUID --confirm SUBJECT_UUID \
  --reference VERIFIED_SUPPORT_REFERENCE

# Begin only after separate hosted-operation authorization and policy readiness.
node --conditions=react-server scripts/process-account-deletion.mjs \
  --request REQUEST_UUID --subject SUBJECT_UUID --confirm SUBJECT_UUID \
  --reference VERIFIED_SUPPORT_REFERENCE --execute

# Read status without external effects.
node --conditions=react-server scripts/process-account-deletion.mjs --request REQUEST_UUID

# Advance one bounded phase, then inspect status; reuse the same request ID.
node --conditions=react-server scripts/process-account-deletion.mjs --request REQUEST_UUID --execute
```

Use a single operation per subject. `closing` handles at most 20 affected flights per invocation. The committed first phase immediately disables membership; active requests may still occupy capacity until closure runs. Repeat until the receipt reaches `photos`, then wait for the photo drain rather than clearing its timestamp manually. The drain covers current processing/cleanup leases and at least 90 seconds for bounded application photo work; the photo pipeline has bounded download/processing/upload operations. Do not delete the parent profile while lifecycle cleanup is pending.

The `photos` step reuses owner-scoped leased cleanup, then removes at most 20 inventoried orphan objects in the two profile buckets and rechecks the database. Only exact owner-prefix paths from the guarded receipt can be removed. No bucket-wide delete occurs. A failed or lost Storage response leaves the phase pending. Repeat status/step until the empty inventory and acknowledged lifecycle permit profile removal.

The `auth` step uses Supabase's **irreversible soft deletion** (`deleteUser(subject,true)`), then reads the same subject back before confirming. This removes login identity and credentials while retaining the Auth UUID tombstone needed by restrictive shared-history FKs; it is not physical row deletion or anonymization. An ambiguous outcome is reconciled on the next run, not assumed failed or followed by a new target/request. Membership remains disabled throughout.

`retention_pending` means immediate account removal is confirmed, while the original `verified_at + 60 days` retention deadline remains. The database's named minutely `volo-account-deletion-retention` job processes up to 20 due subjects at a time. It minimizes target invitation emails/reasons, deletion-related report/audit content and execution verification payloads while preserving other recipients' live invitations, report reference evidence and shared message/flight history. After that subject’s deadline, report intake serializes against the retention job and stores only a canonical reason placeholder for their retained targets. The reporter/request/target receipt remains stable; expired personal reason text is not recreated or hashed into another archive. The report form discloses this limitation. Necessary UUID tombstone references remain pseudonymous. A new run/retry never resets the clock. `purged` confirms the database retention phase, **not provider backup/log expiration**. Verify provider evidence separately. An incomplete external cleanup remains overdue even after its temporary audit payload has been minimized; do not report it as complete.

## Failures and verification

The read-only begin preview prints the authorized target UUID/display name and impact counts for confirmation, without other pilots’ content or Storage paths. Treat that preview as private operator output. Subsequent steps print bounded phase/status data and generic failures, never credentials, Storage contents, support transcripts or provider payloads. Preserve the request reference in restricted founder notes. After a timeout, inspect that same receipt before advancing. Never reactivate membership, disable FK/immutability checks, cascade shared records or run an arbitrary Auth/Storage delete to force a green status. Database phase receipts cannot roll back external erasure.

Verify the subject cannot use old sessions, login, setup/recovery, private pages, mutation RPCs, Storage or Realtime; verify the remaining participant's authorized history shows **Deleted pilot**, is read-only, and does not reveal a hidden/PRIVATE flight through another reference. Check unrelated pilots' profiles/flights/invitations remain intact. At the deadline, check scheduler success, due/overdue receipts and provider expiration/restore evidence. Restore backups only into an isolated environment until deletion decisions are reapplied; a restored grant must never readmit a tombstone.

Local/disposable fixtures are the only write-test environment for this PR. Netlify Deploy Previews share production Supabase. Keep production publishing locked, and record preview verification separately from any authorized production release/deletion evidence.
