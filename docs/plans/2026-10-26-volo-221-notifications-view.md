# VOLO-221 — Notifications and guarded read markers

Spec: VOLO-221 and parent VOLO-84. Reuse the existing recipient-only notification store and request/message fixtures. Explicit marking is one-way, timestamped by the server and idempotent; viewing never marks automatically. Paginate newest-first with the existing timestamp/UUID keyset convention. Generic event text avoids copying private source content. Target navigation remains VOLO-222.

1. Prove recipient-only marking, metadata immutability, stable retries, disabled/anonymous/admin denial and safe missing/foreign outcomes in SQL; observe baseline failure. Add focused query/mutation unit checks for data validation, keyset boundaries, revocation, input and ambiguous receipts.
2. Add a narrow authenticated mark-read RPC and immutable metadata trigger guard. Add a session-only paged query and guarded action, notification page with explicit read controls, safe loading/empty/error states, protected navigation and private cache-path coverage. No unread counter, public writer, target resolver or hosted changes.
3. Reuse the owned local request/message stack and real-auth app fixture for recipient reads and native/fetched marking, persisted refresh, denials and safe errors. Verify scoped SQL, unit, types/lint/boundaries and a local browser pass, then one fresh review, commit, push and create the requested PR.

Review focus: direct grants stay closed; only the active recipient marks; source/identity/event/time metadata stay immutable; concurrent retries keep the first timestamp; session changes discard rows; timestamp precision and pagination ordering; safe state after uncertain writes; no shared-cache or target-data exposure.
