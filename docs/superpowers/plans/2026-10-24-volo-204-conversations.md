# VOLO-204 Conversation Persistence Implementation Plan

**Goal:** Persist authorized one-to-one conversations only after flight-request acceptance, as chosen by the user on October 24, 2026.

**Architecture:** One conversation per immutable flight request, with exactly two immutable participant columns derived from flight owner/requester. Derive flight linkage through the request. Ordinary session RLS preserves active participants' history independent of live PRIVATE selection; no administrator bypass. A guarded idempotent request-ID-only RPC creates/reopens a thread after checking current acceptance, open flight, both active memberships and current PRIVATE selection under the common flight lock. Past departure alone is not closure. No profile prerequisite for an existing approved connection.

**Tech stack:** Existing Supabase PostgreSQL 17, pgTAP and generated TypeScript types. No UI or message schema in this ticket.

**Constraints:** No independent messaging, group chat, arbitrary participant writes, hosted writes or production publishing. Use feature/ branch and owned local fixtures. Preserve unrelated AGENTS.md and docs/audits changes.

**Lifecycle:** A closed_at marker records closure atomically with request withdrawal/cancellation or flight closure. Existing recipient-removal and withdrawal fences must be replaced by actual integration. Re-add and pending resubmission do not reopen a thread. A later fresh acceptance permits the explicit guarded create/open RPC to reopen the same retained history. Restrictive FKs avoid accidental cascading history deletion; account deletion remains separate.

- [x] Add focused pgTAP regressions and observe failure on baseline schema.
- [x] Add conversations constraints, binding trigger, participant SELECT RLS/grants, guarded create/open RPC, and atomic closure triggers; replace old fences without weakening request/recipient guards.
- [x] Upgrade the two placeholder-fence tests to assert integrated lifecycle behavior; run affected request/connection/cancellation/recipient SQL tests.
- [x] Verify upgrade preserves existing Auth/member/profile/flight/request/recipient data, creation/closure concurrency, and generated types. Add migration version to existing CI allowlists.
- [x] Independently review and record verification. Commit/push and PR creation follow verification; no release.

**Review focus:** Wrong/missing/disabled identities and admin metadata cannot bypass pair binding; pending/closed PRIVATE requests cannot create; concurrent calls share one ID; closure versus creation serializes; history reveals no current PRIVATE flight fields; immutable participants and restricted deletes preserve historical pair; fresh acceptance is required after resubmission.
