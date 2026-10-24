# VOLO-205 Message Persistence Implementation Plan

**Goal:** Persist bounded immutable plain-text messages with participant history reads and stable ordering, without exposing sending before VOLO-81.

**Architecture:** Reuse accepted-request conversations and the immutable owner/requester pair. Messages store UUID, conversation UUID, authenticated sender UUID, body and server timestamp. Derive flight/request through conversation. Restrictive FKs retain shared history; no edit/delete workflow or read receipts. Use a 1–4,000 Unicode-character body with at least one non-whitespace character, preserving submitted text. The 4,000 limit is an implementation default for coordination messages, not a separate founder scope decision.

**Security:** Active participants can SELECT history even after closure or PRIVATE removal; no admin bypass or flight visibility grant. No authenticated INSERT/UPDATE/DELETE and no service-role message-write grants in this ticket. A persistence trigger also enforces sender=auth.uid(), exact pair, both memberships active, accepted/open/current PRIVATE eligibility and unclosed thread. Lock flight, request, conversation before validating live state and timestamping. No exposed send RPC, message UI, realtime publication, notifications or privileged server client.

**Ordering:** Immutable server-generated created_at with UUID tiebreaker; index (conversation_id,created_at,id). This is a stable history order, not an assertion of network delivery order. Timestamp is taken after lifecycle lock acquisition and cannot predate conversation creation.

- [x] Write focused pgTAP schema/access/ordering/lifecycle regressions and observe baseline failure.
- [x] Add migration, minimal RLS/grants, immutable binding trigger and ordering index.
- [x] Verify message/lifecycle SQL, concurrent persistence versus closure, real session participant reads/direct-write denial, additive upgrade preservation and generated types. Reuse existing harnesses; update existing migration allowlists.
- [x] Independently review and record results. Commit/push and PR creation follow verification; no hosted migration or release.

Use feature/ branch, owned fictional local resources and targeted checks. Preserve unrelated AGENTS.md/docs/audits changes. No full application suite required for this schema-only ticket.
