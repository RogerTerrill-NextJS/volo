# VOLO-112 verification — 2026-10-27

Base: `548f663f44add2b8e94318f604dda82d793feab1` (merged VOLO-111). Branch: `feature/volo-112-recovery-rehearsal`. Node 24.22.1, Next 16.3.8, Supabase CLI 2.119.0. See the [operational runbook](database-recovery.md).

## Executed evidence

`node scripts/verify-auth-integration.mjs --recovery` exited **0**. Four scenarios passed:

| Scenario | Result |
| --- | --- |
| Pinned schema/grants/hooks and fresh target | Distinct generated, registered local projects; catalog manifest and 39 migration versions match before import; target lacks source identity. |
| Logical data and authority quarantine | All 54 COPY tables match source hashes; recovered biography is the backed-up value despite a later source edit; application foreign keys have no orphans; subsequent connections use ordinary trigger mode. All three cron jobs remain inactive; retention readiness remains false. |
| Separate Storage recovery | Metadata alone cannot download the photo. Separate file-byte/attribute restoration produces matching PNG/WebP hashes and `image/webp`; ordinary source-upload reads remain denied. |
| Real Auth and compiled app | Fresh restored owner session reads matching metrics and saved outcome; disabled member is denied metrics and ordinary protected outcome reads; unrelated admin cannot read private messages/connection/outcome; real photo HTTP response is 200, no-store, and matches the backed-up WebP. |

The logical backup/import plus app proof took **47 seconds**, excluding cleanup and initial source setup. This local measurement is not a production RTO. Schema manifest SHA-256: `f4a2b0b7c1ee3d5fc12c0760e20ad33bc999a81045bc00ca4a6a8cfe5dd9484a`.

Only fictional seeds/accounts/records were used. Source and target were destroyed and private artifacts removed by successful cleanup. No hosted database, Auth, Storage, email, Netlify setting, production deployment or shared backend was changed. No persistent environment/service was introduced.

## Findings resolved during rehearsal

The local SQL operator needed the managed administrative role and scheduler API to pause jobs. Storage's actual local file root is `/mnt`. Initial file copying preserved bytes but lost extended MIME attributes, causing the real app photo route to reject the download. The pinned image's BusyBox tar cannot preserve those attributes. The final fixture uses Storage's installed `fs-xattr` library to capture/restore both bytes and attributes; product validation and policies are unchanged.

Independent review identified cleanup gaps: app shutdown failure could skip target cleanup, and the target registry needed a stable cleanup path. Cleanup now attempts all resources, retains private artifacts if cleanup fails, and `--cleanup --recovery` covers both registered stacks. Targeted tests cover shutdown/fixture/target failures.

## Additional checks

- **25 passed:** cleanup, owned-stack and real-session unit tests, using the quiet Node test reporter.
- **Passed:** focused ESLint on runner, recovery helper and cleanup tests; `git diff --check`.
- **Not run:** full application suite, unrelated feature groups, hosted restore/PITR, production publication or hosted app writes. The integration itself builds and runs the compiled app fixture.

## Remaining beta gates

This proves exact-migration rebuild plus logical **data** restore, not standalone roles/schema import or physical/PITR recovery. Roles/schema dumps were reference artifacts. The file-backend snapshot is not a proven hosted Storage/S3 recovery method.

Hosted backup availability/cadence/age, encrypted off-site custody, restore access, Storage copies, provider retention and an agreed RPO/RTO remain unverified. Apply the approved **60-day** deletion-related retention policy to actual backups/copies and verify expirations. Reconcile post-backup deletions and other authority changes before reopening; the fixture tests disabled membership but not deleted-user resurrection/tombstone reconciliation, old-session invalidation or a restored true retention gate. Managed keys/Vault/provider/Auth/SMTP/OAuth settings are also outside this proof. Jobs and deletion readiness stay off pending that work. These gaps are beta readiness blockers, not implied successful checks.
