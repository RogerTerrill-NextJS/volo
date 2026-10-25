# VOLO-208 message wiring implementation plan

> Execute inline using superpowers:executing-plans; perform a fresh whole-change review before PR creation.

**Goal:** Implement guarded send actions and bounded participant history reads for VOLO-79, ready for VOLO-209's chat screen.
**Architecture:** Existing ordinary session clients, action mutation guards and locked send RPC remain authoritative. No new store, migration, public API route or production chat UI. History never grants live flight access. Explicit retries retain the same message UUID, conversation and exact body; ambiguous confirmation never triggers an automatic resend.
**Spec:** VOLO-208 / VOLO-79 and docs/volo-206-verification.md; existing accepted-request-only and closed-history decisions apply.

## Task 1: Guarded reads and sends

- [x] Write and run failing `tests/message-wiring.unit.mts` covering strict input and Unicode bounds; verified sender and pair checks; exact confirmation; ambiguous transport; foreign/revoked history; stable microsecond timestamp/UUID paging; closure and unavailable write authority.
- [x] Add `lib/messages/input.ts` (strict three-field send payload), `send-mutation.ts` (ordinary participant precheck and locked RPC), `actions.ts` (existing origin/access/form guard), and `history-query.ts` (30+1 newest-first keyset query, chronological returned page, final participant/access recheck, separate live send availability). Export safe DTOs only. Normalize CRLF/CR to LF before sending so native and fetched forms retain the same logical retry payload; preserve all other body characters.
- [x] Run targeted unit tests, TypeScript, focused ESLint and boundary checks. Add the unit file to the existing CI unit group.

## Task 2: Real-session wiring verification and PR

- [x] Extend existing real-Auth fixture with a test-only action form and history endpoint, plus fault injection for lost/malformed sends; reuse the existing action invoker.
- [x] Extend existing flight-interest cases: native/fetched actual send actions and metadata-only confirmations, rejected origin/identity/foreign/closed/disabled cases; exact retry stores one message; lost/malformed confirmation never retries automatically; read pages preserve closed private history and exclude strangers/admins. Verify Unicode and stable order with owned data.
- [x] Run the targeted real-session group and confirm owned cleanup. Record checks and skipped full/hosted checks in docs/volo-208-verification.md.
- [ ] Fresh independent security/correctness review, resolve findings with focused checks, commit/push feature branch and create/attach PR.

## Review focus

Untrusted form identity and duplicate fields must never select sender. Invalid/malformed confirmation must never claim success. Microsecond timestamps and tied UUIDs must page without duplication. Closure/counterpart disabling must close sends while preserving permitted history. Mid-read viewer revocation must discard all history. All reads and mutation responses remain private/no-store; no profile completeness prerequisite on an existing approved connection.

Review correction: persisted rows use bounded valid-text shape validation rather than the stricter JavaScript blank-input check. PostgreSQL accepts U+FEFF as nonblank; a read-only owned database probe confirmed it. Both new history reads and the existing conversation preview now retain access for that valid text; invisible previews have a neutral fallback. Regression tests failed before the correction and passed after it.
