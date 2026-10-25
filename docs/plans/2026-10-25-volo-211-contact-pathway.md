# VOLO-211 contact pathway implementation plan

> Execute inline using executing-plans and targeted verification under the repository MVP policy.

Goal: connect the existing accepted connection page to its authorized conversation without introducing another contact channel or relationship state.

Authoritative scope: VOLO-211 / VOLO-72. VOLO-70/71 and VOLO-81 are Done; chat and Realtime prerequisites are merged through `bb16cfb`. User has requested implementation and PR and previously opted out of extra design approvals. Continue in the existing checkout on `feature/volo-211-contact-pathway`, preserving unrelated AGENTS.md and docs/audits changes.

## Task 1: guarded conversation entry and connection UI

- [x] Add behavior tests for strict request-only input, accepted participant resolution, mismatched returned conversation identity, revoked approval, transport failure and retained participant-only history. Run to observe missing implementation.
- [x] Implement `lib/messages/open-mutation.ts` using the existing action guard and ordinary-session RPC. Recheck the accepted connection and validate the returned persisted conversation against the request and original pair. Derive redirect solely from confirmed metadata. No GET writes or client participant/conversation IDs.
- [x] Add `lib/messages/connection-query.ts` for a read-only, viewer-checked retained conversation link. Guard before/after reads and reject mismatched projections.
- [x] Wire `actions.ts` and `contact-form.tsx` under the connection route. Support native action submission, pending feedback and safe retry without raw provider errors. Add an obvious Message pilot form to accepted views; closed views link only to their retained thread or display neutral missing/unavailable history feedback.
- [x] Extend the existing real-session harness for the actual page action, repeated opening by both participants, tampered pending/foreign IDs and closure. Extend existing boundary checks for the new server modules. Run targeted unit/integration/static checks and inspect the browser path using owned disposable local resources.
- [x] Independent whole-change review, address meaningful findings with regression checks, record verification, commit and create PR. No hosted test writes, migration or production publication; preview and release verification remain separate.

Review focus: action must independently guard origin/session/input; no role bypass or participant IDs from forms; returned UUID must match the approved request pair; stale accepted pages cannot open after withdrawal/PRIVATE removal/disabled membership; native and hydrated paths must reach the same permitted chat; retained history must not create a conversation or restore writable flight access.

Completed with 27 targeted unit checks, six real-session scenarios, actual Chrome checks and independent review. Detailed evidence and verification limits: `docs/volo-211-verification.md`.
