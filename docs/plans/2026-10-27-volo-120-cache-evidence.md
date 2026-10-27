# VOLO-120 cache evidence plan

Goal: preserve the strict hosted cache gate while producing a complete, bounded diagnostic report and recording the unresolved provider dependency. Base: merged main `66aa20f`.

Scope comes from VOLO-120. The user confirmed on 2026-10-27 that Netlify has not replied. Do not invent the trace explanation or equate missing storage markers with non-storage. Reuse the existing reporter; no app behavior, cache policy, CI gate removal, hosted writes/accounts, publication or CDN emulator.

Approach: update the current reporter in place. A documentation-only change would leave Netlify's documented `stored=true` example classified as inconclusive and the matrix truncated at the first Age anomaly. A provider-specific pass exception would require the missing support evidence and is excluded. Keep positive Age as an unresolved failing gate, while labeling it separately from explicit hit/storage and policy failures. Add request IDs/timing/body hashes only; never output bodies or cookie values.

- [x] Add behavior regressions in `tests/preview-cache.test.mjs`: documented true storage is a hard failure; false token/missing/malformed evidence cannot pass; positive Age stays a failure and the bounded matrix completes; missing no-store and explicit hit/storage retain failure precedence; public hit control is required for a passing observation. Run RED.
- [x] Modify `scripts/verify-preview-cache.mjs` to accumulate safe observations/checks, preserve no-store/status/redirect/body/cookie checks, classify failure categories, require a reported public/static hit, and keep missing affirmative evidence inconclusive. Run the targeted tests and focused lint.
- [x] Run one bounded anonymous same-URL HTML/RSC/prefetch/HEAD matrix with public/static controls against the verified immutable PR120 deployment (`6ae1155b56ba34e7b403d95a`, head `757ac03`). Record exact identity and evidence in `docs/volo-120-verification.md`; update current caching docs. Do not rerun unchanged hosted traffic to chase a pass.
- [x] Review the whole diff, verify targeted checks, commit/push and create/attach a PR. Ticket remains incomplete pending support explanation and supported hosted non-storage evidence; VOLO-110 owns authenticated isolation.

Validation: 13 targeted tests passed; focused lint, documentation links and diff checks passed. Independent review finding (login HTTP 200 invariant) fixed with RED→GREEN regression. Hosted run exited 1 with eight Age anomalies and 58 inconclusive private observations; no support explanation exists, so ticket completion remains blocked. This is a partial delivery PR, not a resolution claim.
