# VOLO-220 — Generate notifications in owning operations

Base: merged VOLO-219 (`c22dd7d`). The existing identity-derived `submit_flight_interest`, `decide_flight_request` and `send_conversation_message` operations now create notifications inside the source transaction. Successful new/resubmitted interest notifies the flight owner; acceptance notifies the requester; a new message notifies the opposite immutable participant. The private persistence trigger derives recipients, event identities and metadata from source records. Existing authorization, lifecycle locks, signatures, grants and minimal receipts are preserved.

Matching request/acceptance retries and exact message UUID retries preserve the original notification identity/time. Eligible same-record resubmission and reacceptance are separate occurrences. Declines, denied/conflicting operations and closed-conversation sends generate no event. A notification persistence failure aborts its source write; acceptance inserts sit outside the existing source eligibility exception handler so a notification error cannot leave a committed acceptance without its event.

There is no public notification writer, historical backfill, event bus, worker, email/push or notification UI/read API. VOLO-221/222 retain responsibility for recipient views, guarded read markers and navigation that rechecks current target access. Privileged source fixtures/imports do not emit operation events.

## Verification

- The new generation regression failed on the merged baseline in an owned disposable local Supabase stack. After migration, **344 checks passed across eight targeted SQL files**: notification generation, notification persistence, flight requests, flight interest, request decisions, request withdrawal, conversations and message permissions. Cases cover all three recipient directions, exact retries and original chronology, private/unrelated denials, distinct resubmission/reacceptance, no decline event, payload minimization and injected notification failures rolling back each source write.
- **45 existing lifecycle concurrency cases passed** for submissions, decisions, messages, conversations, withdrawal, cancellation and edits. The actual competing database locks were observed. Added assertions verify one notification per committed message (including concurrent same-UUID retry), one per successful pending occurrence, and one per acceptance despite waiting retries/conflicts.
- **21 infrastructure/upgrade-guard tests passed.** Existing disposable fixture cleanup removes scoped retained notifications before deleting request/message targets; migration-history expectations include the new migration. No new test harness/job was added.
- Public database types regenerated from the migrated owned database were unchanged. Route generation, TypeScript, focused ESLint and whitespace checks passed.
- One independent read-only branch review found no actionable defects or deferred findings.

**56 signed-in integration scenarios passed** using the existing `verify-auth-integration.mjs --flight-interest` runner: native/fetched submission, recipient-only notification reads, acceptance/decline, request lists, chat permissions/composers/history, retries, cancellation, edits and withdrawal. All owned disposable database/app resources were cleaned up successfully.

The full suite, unrelated SQL matrices and destructive prior-schema upgrade were not repeated under the MVP policy. CI and Netlify Deploy Preview verification remain separate and pending. No hosted migration/data/account/email/settings changes or production publication occurred.
