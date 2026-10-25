# VOLO-206 Message Permissions Implementation Plan

**Goal:** Expose authenticated, participant-bound message sending while preserving closed history and proving direct/Realtime isolation.

**Architecture:** A session-only `send_conversation_message(conversation UUID,message UUID,body text)` RPC derives sender from auth.uid(), validates the existing text bound and serializes on flight/request/conversation before rechecking both active memberships, accepted/open/current PRIVATE selection and closed_at. A caller message UUID supports exact-payload idempotent retry while the connection remains writable; mismatches cannot overwrite or reveal another record. Direct table mutation grants remain closed. Reuse VOLO-205's immutable persistence trigger and participant SELECT RLS.

**Realtime:** Publish only message INSERT events after the same SELECT RLS is installed. Do not publish DELETE events, which Supabase cannot authorize against a removed row. Preserve existing publication settings/tables unless the owned message stream is the only configured table; fail closed on unexpected shared publication configuration rather than change unrelated delivery. Test actual local WebSocket recipients and retained-token disablement. Realtime UI/subscription lifecycle belongs to VOLO-210.

**Scope:** No message screen, conversation list, receipt, notification, broadcast channel or service-role send bypass. The later VOLO-208 wiring must use verified session clients, existing origin/input guards and private/no-store responses, and render body as escaped text. No new shared/server/service-worker message cache is created.

- [x] Observe failing RPC/publication permission tests, then add the minimal migration and generated types.
- [x] Verify exact sender/pair and body bounds, duplicate retry, foreign-ID conflict, closed/private/disabled denial and retained history through SQL and real sessions.
- [x] Exercise RPC versus lifecycle closure races using the existing lock harness and real Realtime delivery/denial using existing local Auth fixtures.
- [x] Verify additive upgrade preservation, affected SQL/static checks and independent review. Cleanup, commit/push and PR creation follow final verification.

Use feature/ branch and fictional owned local resources only. No hosted migration/settings/accounts/email or production publication. Preserve unrelated AGENTS.md/docs/audits edits; run targeted tests under MVP policy.
