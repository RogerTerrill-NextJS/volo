# VOLO-204 — Authorized one-to-one conversation persistence

Based on merged VOLO-203 (`d2c759e`). The user chose **accepted flight requests only** on October 24, 2026; independent direct messaging remains outside this implementation.

`conversations` retains one thread per request with exactly two immutable participant IDs derived from the request and its flight owner. Flight linkage is derived through the immutable request rather than copied. Restrictive foreign keys prevent accidental history cascades. No general participant management, message table, read-position system or UI is added.

`get_or_create_flight_conversation(request UUID)` uses ordinary authenticated sessions. It locks the flight and request, locks both active memberships, and reuses the authoritative accepted/open/current-PRIVATE-selection connection predicate before creating or explicitly reopening a thread. Both pilots receive the same ID; pending, unrelated/admin, disabled, cancelled and removed callers cannot open it. Past departure and missing profile alone do not revoke existing acceptance. This RPC is not a durable sending grant.

Participant SELECT RLS requires the viewer's active membership and the immutable pair, with no administrator bypass. Closed history survives cancellation, withdrawal and PRIVATE removal without granting current PRIVATE flight access. Members have no direct write/delete grants. Service role has SELECT/INSERT/UPDATE, subject to binding triggers, but no DELETE or RPC-execution grant; account/history deletion remains separately defined work.

Request and flight lifecycle triggers close existing threads atomically. The migration replaces the two temporary conversation-presence fences while retaining their original ownership, state and selection checks. Withdrawal/resubmission does not clear closure. After eligible resubmission and fresh owner acceptance, an explicit open call can reopen the same retained thread. VOLO-81 must check live acceptance, open flight, memberships, selection and closed_at under the same flight-lock protocol for every future send; no message write is authorized by this ticket.

## Verification

- New pgTAP tests failed against the baseline before implementation. Final conversation coverage: 47 checks for constraints, grants, identity/pair binding, participant history RLS, privileged forgery rejection, duplicate prevention, withdrawal/reapproval, cancellation, completion, PRIVATE removal, and profile/departure independence.
- Seven affected SQL files passed 270 checks: conversations, withdrawal, recipients, cancellation, connections, decisions and interest.
- Eight overlapping-transaction cases passed using the existing lock harness: duplicate opens and open versus withdrawal/cancellation/removal in both orders, plus delayed creation after a queued withdrawal. Each case observes the competing flight lock and verifies the resulting unique/closed history.
- Independent review found a real timestamp race: statement start could precede a thread created while closure waited. The added overlap regression reproduced the closure constraint failure. The trigger now clamps wall-clock closure time to the stored creation time; the regression and final SQL checks pass. Review approved the correction.
- Upgrade from the preceding schema preserved owned fictional Auth/member/profile/flight/request/recipient snapshots without fabricating threads. Generated types match the upgraded schema. Existing CI migration allowlists and concurrency execution include this migration.
- 42 real local Auth flight-interest integration scenarios passed and fixture cleanup completed. The added scenario checks direct session pair binding, unrelated/admin denial, immutable participant access, withdrawal/resubmission/reapproval and retained PRIVATE history. A bounded test-only cleanup method uses the existing disposable stack ownership checks rather than widening production DELETE grants.
- 17 local-stack infrastructure tests, route type generation, TypeScript, focused ESLint, Supabase client/server boundary checks and diff checks passed. No new browser screen exists in this schema ticket.

A regression run overlapped the lock tests and exposed an unscoped setup UPDATE in the new SQL test. It is now restricted to its fixture request IDs; the final affected SQL run passed independently. The initial lock-test attempt also omitted the competing transaction's BEGIN, losing its SET LOCAL identity; that harness setup was corrected before all overlap checks passed.

All writes use owned fictional local resources, cleaned up after verification. Full-suite, unrelated SQL/invitation concurrency and hosted Deploy Preview checks are not rerun under the MVP targeted-test policy. No hosted migration, accounts, messages, email, Netlify settings or production publication changed. Preview verification and any later approved migration/release verification remain separate.

## CI correction

PR #91's initial database job failed in `flight_requests.test.sql:125`: a third legacy fixture attempted to create a dummy `conversations` table after the real migration had created it. The initial targeted selection omitted this request-persistence file. The failure was reproduced locally before replacing that block with real accepted-thread creation, recipient removal, request cancellation, retained closed history and reopen denial. The corrected request/conversation tests passed all 115 checks, independent review approved the test-only correction, and a search found no remaining placeholder conversation tables. Application code and production schema behavior are unchanged by this correction. The complete CI database job is rerun on the pushed fix.
