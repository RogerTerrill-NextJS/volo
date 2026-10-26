# VOLO-222 — Authorized notification navigation

Spec: VOLO-222 and parent VOLO-84. Add a fixed link from each existing notification row to a session-only server lookup. Request notifications go to the existing flight's Incoming requests section; acceptances go to the existing connection page; messages go to their existing conversation. Each destination retains its own current authorization and closed-history behavior.

1. Write focused destination lookup tests for all three mappings, recipient/source binding, invalid/foreign/missing records, outages and mid-read identity revocation. Observe failure before the module exists.
2. Add the minimal lookup and protected resolver page with safe unavailable/retry states. Add event-specific list links with prefetch disabled. Do not mark read on navigation, enrich notification rows, change destination permissions, store URLs, add counters or change SQL.
3. Reuse the existing request/message fixture to verify permitted request/acceptance/message paths, foreign/admin denial and a stale acceptance that reaches the existing unavailable destination. Run related units, type/lint/cache checks, a local browser pass and one fresh review. Record evidence, commit, push and create the requested PR.

Review focus: only recipient-scoped session reads; fixed same-origin paths from canonical source UUIDs; target source types/bindings; current destination authorization remains authoritative; missing or stale sources fail safely; navigation does not mutate read state; no shared caching or private content in notification rows.
