# VOLO-212 — Cross-feature connection and communication permissions

Base: merged VOLO-211 (`ab528ac`). Scope: VOLO-74's connection view and contact-entry verification after the approved chat pathway exists. This change extends the existing real-session scenarios; it adds no application behavior, schema, Auth stack, or permission model.

## Distinct integration coverage

Two scenarios in `tests/helpers/flight-interest-cases.mjs` exercise the actual connection page → contact Server Action → chat page/action path:

| Actor or state | Expected behavior checked |
| --- | --- |
| Posting pilot and accepted requester | Both resolve the same conversation; a native page send is readable by both. |
| Selected pending requester on the same PRIVATE flight | Their pending request has no accepted view or contact control. Altering request IDs or submitting the accepted pilot's captured form cannot enter that conversation or change communication records. |
| Unrelated active member and disabled account | Accepted connection details, message text and composer remain absent; contact submission has no conversation destination. |
| Accepted requester disabled after opening | Captured contact forms fail for both pilots; the disabled viewer cannot read or send through a stale composer. The active owner's history remains readable with closed send authority. |
| Flight cancellation or PRIVATE recipient removal | Both pilots receive closed request/history paths. Captured native/fetched contact and chat forms cannot reopen or send; messages remain readable to their active participants. Removal does not restore the requester's PRIVATE flight access. |
| Withdrawal, then resubmission | Retained chat remains read-only. Both old contact forms and captured native/fetched composers remain blocked while the same request is pending. Fresh acceptance lets both pilots reopen the exact original conversation and send again without losing retained messages or creating another conversation. |

Denied attempts compare complete persisted request, conversation and message snapshots for every request on the source flight, including conversation closure timestamps. This covers unintended creation under the forged pending request as well as changes to the accepted conversation. Existing response helpers check private no-store headers and credential/provider-error exclusion. The new tests reuse existing owned accounts, actual page action metadata, ordinary participant sessions, lifecycle RPCs and cleanup.

## Existing evidence reused

- [VOLO-66: atomic acceptance and capacity](volo-193-verification.md), with [owner action integration](volo-194-verification.md): owner identity, live eligibility, restricted RPC, direct-update denial and concurrent last-place approvals. No new acceptance matrix or concurrency harness.
- [VOLO-73: closed connection presentation](volo-203-verification.md): both perspectives, retained introductions, closure races and fresh approval after resubmission. This ticket tests the subsequently added contact/chat path across those states.
- [VOLO-81: participant/sender/closed-state policy](volo-206-verification.md), [guarded sending/history](volo-208-verification.md) and [live delivery](volo-210-verification.md): SQL/RLS, forged sender and direct API denial, current membership, INSERT-only Realtime and lifecycle cleanup. No duplicate publication or Auth-policy suite.
- [VOLO-72: contact pathway](volo-211-verification.md): native/fetched opening, exact pair validation, deduplication, origin/input guards, transport recovery, retained-history lookup and browser accessibility/mobile checks.

## Verification

- All 18 selected real-session connection/contact/message/chat scenarios passed, including the two new cross-feature cases; owned resources were cleaned up.
- Independent review found two assertion gaps: the original snapshot omitted conversations for the forged pending request, and the resubmission loop did not post its captured stale composers. The snapshot now covers every source-flight request and its conversations/messages; both participants' native/fetched composers are submitted while pending. Both strengthened scenarios passed again with owned cleanup. No application defect surfaced.
- All 27 targeted connection entry/view/history, message wiring and mutation-guard unit checks passed. Focused ESLint and diff checks passed. The real-session harness production build compiled the existing application pages and actions. No new fixture transport or standalone Auth stack was added.

All writes use fictional owned local resources. Full suite, unchanged SQL/concurrency and repeated browser presentation checks are outside this focused test-only ticket. Hosted Deploy Preview verification and any production release remain separate; no hosted data/account/email/settings changes, migration or production publication are requested.
