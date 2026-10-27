# VOLO-227 — Account deletion verification

Base: merged VOLO-226 (`fa76d8b`). Implements the approved verified-request/founder-admin execution, retained shared history and 60-day retention policy. [Operator runbook](account-deletion-operations.md) documents the private support verification, read-only impact preview, exact target confirmation and bounded resumable CLI. No hosted operation or production publication was performed.

## Implementation

The initial committed RPC phase checks the current active administrator and disables the target before external effects. It rejects self-execution, conflicting request identities and unverified retention readiness. Later RPCs independently check current authority. Closure processes up to 20 flights per step, preserves terminal/shared records and releases accepted capacity. Existing owner-scoped photo cleanup is reused; current/pending/processing work, processing/cleanup lease drain and orphan Storage metadata are checked before parent removal. The existing Storage commit-time ownership guard remains unchanged and prevents late writes after membership disablement.

Supabase's supported irreversible soft deletion was proved with real local Auth. It removes the original login/credentials and user metadata while preserving the UUID tombstone needed by restrictive FKs. A matching provider/DB readback is required before immediate completion. This is not physical Auth-row removal or anonymization. Shared history remains pseudonymous; no participant/private-read policy was broadened. **Deleted pilot** appears in conversation lists, messages, closed request/flight history and incoming requests without a profile/photo link. Label reads occur before existing final identity/access rechecks.

The private policy gate defaults off; a separately authorized operation must record actual 60-day provider/backup capability evidence before enabling hosted execution. Local tests explicitly enable it only on their owned disposable project and reset it afterward. No local test establishes hosted retention compliance.

Retention uses 1,440 elapsed hours (60 UTC days), unaffected by a caller's daylight-saving timezone. A minutely bounded database job minimizes due personal execution, invitation, report and audit payloads. Report references about other pilots survive; expired reason text is replaced. Intake serializes against the retention boundary and canonicalizes later reasons for the departing pilot's retained targets, so those reports cannot recreate an indefinite personal archive. The form discloses reference-only retention. Incomplete external work remains visibly overdue and resumable after its temporary payload is minimized; the deadline never restarts.

## Checks — 2026-10-26

| Check | Result |
| --- | --- |
| New deletion SQL | **55 passed** |
| Existing affected SQL | **176 passed**: member administration 31, cancellation 36, profile photos 32, message permissions 33, report intake 44 |
| Focused Node unit tests | **35 passed**: runner safety/retry/path validation, retained conversations/requests, label-time access revocation, photo cleanup and report intake |
| Existing real-Auth integration harness, deletion group | **4 scenarios passed**, with real local Auth/Storage and compiled production routes; actual operator CLI preview/begin/Auth step included |
| Next type generation / TypeScript | Passed |
| Focused ESLint / diff checks | Passed |
| Generated public database types | Regenerated from the owned local schema |

The four real-service scenarios cover default-off gate/current-admin authorization, actual CLI preview and exact confirmed begin, racing send/access fencing, current and pending photo cleanup, registered and orphan source/final objects, parent retention during drain, Auth soft deletion with old-password denial and metadata clearing, old-session private access denial, retained two-user message/request rendering with **Deleted pilot**, unrelated-admin message denial, demoted-operator rejection and the original retention deadline/payload minimization. Expiry/drain boundaries are backdated only on owned fixture rows; they are not long wall-clock waits. Row ordering is not assumed for preserved history during the concurrent-send check.

## Review and corrections

Independent review identified three issues, each reproduced before the fix and covered by passing regressions:

- Purge deleted reports written by the departing pilot about other users. It now preserves reference evidence and minimizes the personal reason.
- Reports submitted after purge could recreate an unbounded reason payload. Deadline-aware intake now serializes with the retention job and normalizes reasons before stable receipt comparisons.
- Begin lacked the approved impact preview. An admin-only read-only preview now provides target identity and collaboration/Storage/retention counts before explicit execution.

Initial integration setup also correctly failed when a fixture tried a source upload with a privileged client rather than the pilot owner, and an orphan write without a valid reservation. The fixture now uses valid owner uploads and creates orphan bytes only after a legitimate processing/final Storage commit, then removes that owned lifecycle row through fixture SQL. Product ownership/Storage guards were not weakened.

Further focused edges verify a request without a conversation has the correct authorized tombstone label, the 60-day elapsed-hour boundary across a daylight-saving timezone, preserved other-recipient invitations, post-expiry report retry stability, an already-disabled administrator's authorized deletion and overdue work resuming without its expired email payload.

## Limits and release boundary

The full suite and unrelated SQL matrices were not run. UI evidence is compiled real-route HTML and focused access tests; no fresh mobile/browser device pass is claimed. Local fixture services, accounts, objects and rows were cleaned up. Provider backups/log/email retention and restore capability remain **unverified**, so hosted new execution stays gated off. A database `purged` phase does not certify external snapshot expiration. Scheduler failures/backlogs are overdue work to resolve, never permission for a silent extension.

The migration, named retention job and operational enablement require their normal reviewed hosted operations. Netlify Deploy Previews share production Supabase: do not test deletion there using real accounts. Record preview verification separately from authorized production release/deletion evidence and keep automatic production publishing locked.

## PR CI correction — 2026-10-26

The invitation-upgrade verifier rejected the new deletion migration because its explicit ownership allowlist and expected post-upgrade history ended at VOLO-226. Both lists now include `20261105010000`; the fixed prior-schema baseline, GitHub-hosted-runner gate, container owner check and PostgreSQL version check remain unchanged. A focused local check reproduced the missing migration failure, then passed against all 38 committed migrations and confirmed empty/unknown histories remain rejected. Syntax and diff checks passed. The destructive end-to-end upgrade verifier is restricted to GitHub-hosted disposable runners and was not run locally; its rerun remains CI verification.

## Upgrade snapshot correction — 2026-10-27

The subsequent CI run passed build/unit checks and real Auth/session integration, then failed the upgrade snapshot because whole membership rows acquired the two new null deletion columns. The preservation snapshot now explicitly selects every historical membership field, as it already does for Auth fields. A separate assertion requires all three existing fixtures to retain null deletion timestamps. On a fresh owned disposable Supabase project, resetting to the historical schema, inserting the fictional seeds and applying all 38 migrations reproduced the old snapshot mismatch and passed the revised preservation/default checks. That project was cleaned up. Syntax and diff checks passed; the complete GitHub-only concurrency verifier remains CI validation. No application or migration behavior changed.
