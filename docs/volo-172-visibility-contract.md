# VOLO-172 — NETWORK and PRIVATE flight visibility contract

Implementation handoff for [VOLO-57](https://outsidethecockpit.atlassian.net/browse/VOLO-57),
[VOLO-45 / VOLO-173](https://outsidethecockpit.atlassian.net/browse/VOLO-45)
and [VOLO-60 / VOLO-174](https://outsidethecockpit.atlassian.net/browse/VOLO-60).
Prepared on `feature/volo-172-visibility-contract` from merged VOLO-171 (`591f54a`).
This document specifies requirements; it does not implement flight tables or policies.

## Sources and decisions

- [VOLO-172](https://outsidethecockpit.atlassian.net/browse/VOLO-172) asks for concrete
  NETWORK/PRIVATE rules and recipient-change behavior before schema/policy work.
- VOLO-57 limits the model to NETWORK and PRIVATE. GROUP is future work through a
  later migration once its rules exist; no group tables or generic permission engine.
- [VOLO-11](https://outsidethecockpit.atlassian.net/browse/VOLO-11) defines owner-led
  posting and acceptance, private discovery by selected eligible pilots, and loss
  of protected access when a member is disabled.
- [VOLO-13](https://outsidethecockpit.atlassian.net/browse/VOLO-13) proposes flight /
  recipient relationships, current active-membership checks, derived capacity and
  a common flight-lock protocol. Its recipient-removal choice was still open.
- The user resolved that choice during VOLO-172: **remove the recipient, cancel
  their pending or accepted request, and close sending in an associated conversation**.
- The user also chose **read-only prior request/conversation history for both
  pilots**, still requiring active membership. The removed pilot loses access to
  the current PRIVATE flight. These decisions supersede the open removal choice
  in the older Jira descriptions; those descriptions have not been edited here.

## Visibility access

Visibility eligibility requires a verified authenticated identity and a current
`memberships.status = active` row. An Auth account, invitation, profile, JWT role
claim, URL, prior request, notification or conversation alone is not a grant.

| Viewer | NETWORK flight | PRIVATE flight |
| --- | --- | --- |
| Anonymous, unadmitted or disabled | Denied | Denied |
| Active owner | Allowed | Allowed without a recipient row |
| Active selected recipient | Allowed | Allowed while the selection remains |
| Other active member | Allowed | Denied |
| Active admin using ordinary member access | Same member rules | Owner or selected recipient only |

The visibility predicate is:

`active(viewer) AND (visibility = NETWORK OR (visibility = PRIVATE AND (owner_id = viewer OR selected(flight, viewer))))`

This is a visibility condition, not a replacement for lifecycle/moderation rules.
A separate status, hidden-record or operation-specific rule may narrow access;
it must not accidentally broaden PRIVATE visibility. Any administrative moderation
access needs its own guarded, explicitly authorized operation rather than an admin
bypass in ordinary member reads.

Read eligibility checks current membership on every protected data request,
including requests using an existing JWT. Disabling a selected member revokes their
protected access without deleting selection/history rows. Re-enabling membership
can only restore access allowed by the selection/history relationships still present.

NETWORK eligibility does not require a selection row. For PRIVATE selection,
validate each chosen identity as an admitted active member at mutation time;
existence in Auth is insufficient. Reuse the directory for candidate presentation,
not as a durable authorization grant. Profile-completion gates for posting/requesting
remain with those workflows; this contract adds no new profile or visibility fields.

## Recipient removal and retained history

For PRIVATE audience selection, only the current active flight owner can change
its selected recipients through a validated operation. A recipient cannot add themselves or widen the audience.

| State when removed | Required result |
| --- | --- |
| No request | Remove selection and revoke current PRIVATE-flight access |
| Pending request | Cancel request, remove selection, close associated sending if a conversation exists |
| Accepted request | Cancel request/connection, release its accepted capacity, remove selection and close associated sending |
| Already terminal request | Remove selection; retain terminal state/history and do not reopen sending |

For **every removal**, including one that initially appears to have no request,
perform the following in **one transaction**:

1. Lock the flight using the same lock order/protocol as acceptance, withdrawal,
   cancellation and capacity-affecting edits. Recheck current owner identity,
   active membership, current selection and request state after acquiring the lock.
   Do not decide the no-request branch from a pre-lock read.
2. If the request is pending or accepted, transition it to cancelled and end its
   accepted connection when applicable. Do not delete the request or its introductory note/history.
3. Close sending for both pilots in every conversation linked to that request.
   Do not create a conversation simply because a pending request is cancelled.
4. Remove the selected-recipient relationship. All effects commit together or none do.

Request creation must acquire the same flight lock and recheck current PRIVATE
eligibility before inserting. Direct inserts cannot bypass that protocol. If request
creation commits first, removal sees and cancels it; if removal commits first, the
new request is denied for lack of selection. No request can slip in after removal.

Capacity is derived from accepted requests, so accepted-to-cancelled releases the
place without a separately mutable remaining-capacity counter. Retried removal
must not double-release capacity, recreate records or reopen sending. Concurrent
acceptance/removal must serialize against the flight and cannot leave an accepted
request with a revoked private recipient or a writable cancelled conversation.
Message sending must synchronize with conversation closure under a compatible
lock order, so a stale permission check cannot commit a send after closure takes
effect. This does not require every message send to lock the flight row.

Both pilots retain read-only access to their prior request and conversation content
while they are active members. Preserve the participant/requester-owner relationships
needed to authorize that history independently of the live recipient row. The removed
pilot cannot use retained history to retrieve current PRIVATE-flight details, edit
or revive the request, send messages, or acquire a new recipient grant. History
reads must not bypass flight RLS through joins, embedded relations or privileged clients.

Re-adding the pilot may restore current flight visibility under the normal predicate;
it does not automatically revive a cancelled request or reopen a closed conversation.
Whether a new request can be made or a cancelled request can be reactivated belongs
to the request-lifecycle ticket and is not settled by this contract.

## Schema and policy handoff

| Owning ticket | Required implementation |
| --- | --- |
| VOLO-45 / VOLO-173 | Flight UUID, immutable authenticated owner identity, visibility constrained to NETWORK/PRIVATE, and flight_recipients keyed uniquely by (flight_id, user_id) with valid foreign keys. Owner access must not require a duplicate recipient row. Carry the remaining flight fields/constraints from VOLO-45 rather than redefining them here. |
| VOLO-45 / VOLO-173 | Ship initial RLS and least-privilege grants with both tables. Visibility/recipient writes must have a validated transaction boundary; ordinary clients cannot independently update visibility or delete recipient rows to bypass cancellation. Define deletion behavior deliberately; do not cascade away shared request/message history. |
| VOLO-60 / VOLO-174 | Verify NETWORK/PRIVATE reads through direct data APIs using current active membership. The owner can inspect their recipient list; a selected recipient may inspect only their own eligibility as needed. An unrelated member must not enumerate a private audience or infer hidden flights through counts/joins. |
| VOLO-60 / VOLO-174 | Avoid recursive flight/recipient RLS. If a narrow private-schema security-definer predicate is needed, harden its search path, scope it to verified identity and revoke unintended execution. Ordinary flight/profile reads remain session-scoped rather than using a blanket secret client. |
| Recipient mutation and request/conversation tickets | Enforce removal, request cancellation and conversation closure atomically under the common flight lock. Request creation must lock/recheck eligibility too. Request/conversation table introductions must integrate these rules before those features are exposed. Do not create empty future request/conversation tables in VOLO-173. |
| Posting/feed and later read surfaces | Reuse server-only access checks, mutation validation/origin controls and private no-store response handling. A feed, detail URL, search, count, RSC request, subscription or notification link cannot bypass the data-layer visibility rule. |

Changes of visibility mode must not be a second route around recipient-removal
protection. Whether particular post-acceptance visibility/material edits are allowed
remains part of the separate flight-edit lifecycle decision in VOLO-11/13. Do not
expose such an edit until its approved transaction preserves this contract.

## Focused acceptance evidence for the owning tickets

Reuse the membership/profile role fixtures and disposable database/request patterns.
Add cases at the owning feature boundary rather than another Auth outage matrix:

- NETWORK: active member and owner can read; anonymous, disabled and unadmitted
  callers cannot. A spoofed admin claim grants no additional access.
- PRIVATE: active owner and selected active recipient can read; unrelated active
  members/admins cannot. Direct IDs, query parameters, counts and relationship
  queries do not expose the flight or full recipient list.
- Eligibility changes: disable a selected member while keeping their JWT/selection;
  verify fresh access is denied. Remove a selection and verify current flight access
  is denied even when request/conversation history is retained.
- Mutation bypass: foreign-owner updates, recipient self-addition and direct
  visibility/recipient writes cannot bypass the guarded transaction.
- Removal: no-request, pending and accepted cases produce the tabled outcomes;
  accepted capacity is released once; retries are safe; rollback leaves no partial
  cancellation/selection/conversation state.
- Concurrency: request creation versus removal, acceptance versus removal and
  relevant capacity edits obey the common flight-lock protocol. Verify that a
  no-request removal cannot leave a newly inserted pending request behind. Sending
  versus closure serializes under a compatible conversation-lock protocol and final
  authorization state.
- History: both active pilots can read authorized prior content after removal,
  neither can send to the closed thread, and the removed pilot cannot join back to
  current PRIVATE-flight details. Disabled participants lose history access too.
- Re-addition restores only selection-based visibility, without reviving request or
  sending state. GROUP and unapproved visibility values are rejected.

## Scope, verification and review status

The repository has no flight/recipient schema or application flow yet. Existing
`lib/auth/access.ts`, `lib/auth/mutation.ts`, membership RLS, session clients and
private-response handling provide reusable boundaries, not an implemented flight
visibility model. The installed Next.js data-security guidance was reviewed.

Source/consistency review and diff checks were performed, including the
request-creation/removal race and history/live-flight separation.
This is a documentation-only handoff. No application tests were run or added;
no SQL, hosted data/accounts/settings, deployment or production publishing changed.
Review the contract before VOLO-173/174 implementation. General account retention,
independent conversations, accepted withdrawal and material flight edits remain
with their existing lifecycle decisions; none was silently settled here.
