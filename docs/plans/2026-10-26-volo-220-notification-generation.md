# VOLO-220 — operation-owned notification generation

Spec: VOLO-220 and parent VOLO-83. Generate request, acceptance and message notifications inside the existing authorized operations. Preserve notification recipient derivation, source references, uniqueness, and all operation authorization/receipt contracts. No new public writer, backfill, UI, email, worker or hosted writes.

1. Add focused SQL cases proving each event, retry stability, resubmission and atomic rollback. Observe failure on the merged baseline in a disposable local stack.
2. Replace the three existing RPC bodies with atomic notification inserts after successful source writes. Keep decision persistence error handling scoped to the source update. Update existing persistence expectations and owned fixture cleanup for retained notification foreign keys.
3. Run targeted notification/request/message SQL and existing lifecycle concurrency cases, infrastructure guards, type generation/check and lint. Obtain one fresh branch review, record evidence, then commit, push and create the requested PR.

Review focus: authorization and recipient derivation; state/no-op retries versus new occurrences; transaction rollback; unchanged grants/signatures; cleanup restricted to owned fixtures.
