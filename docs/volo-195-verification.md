# VOLO-195 — Request withdrawal and resubmission

Implemented on `feature/volo-195-request-withdrawal`, based on merged VOLO-194
(`38a4135`). The founder explicitly approved withdrawal of pending **and accepted**
requests, with eligible resubmission returning the same record to pending for
fresh owner approval. This resolves the accepted-withdrawal decision left open by
VOLO-188 and parent VOLO-67. VOLO-196 owns application action/UI wiring.

## Contract

`withdraw_flight_request(uuid,uuid)` derives the requester from `auth.uid()` and
requires current active membership. Owners, unrelated requesters and unrelated
administrators cannot withdraw another pilot's request. The RPC locks the flight
before the request and binds the supplied request UUID to both flight and actor.
Missing/foreign/mismatched records share `request_unavailable` without identifiers
or private details. Null identifiers fail with SQLSTATE `22023`; absent/inactive
actors fail with `42501`. Only authenticated callers receive execute permission;
anonymous and service-role execute are revoked and direct member writes stay closed.

Pending and accepted requests become withdrawn, retaining identity, original
creation time and introduction. Capacity is derived from accepted rows, so the
same transaction releases an accepted place without another counter/store. The
persistence trigger continues to own timestamps. A withdrawn retry returns
`already_withdrawn` without updating anything. Declined/cancelled requests return
`request_conflict` and remain terminal. Successful results expose only a fixed
code, matching request UUID and `withdrawn` state.

Withdrawal permits terminal closure after departure/flight closure or loss of
owner, profile or PRIVATE-selection eligibility; the actor must remain active.
Resubmission uses the existing submission RPC: it rechecks open/future flight,
active owner/requester, licensed profile, PRIVATE selection and capacity, replaces
the introduction if supplied, and reuses the request UUID/creation time as pending.
It never restores acceptance automatically. Each command evaluates current state
under the flight lock; an explicit resubmission between withdrawals is a new
pending request state, not an idempotent retry of the earlier withdrawal.

No conversation/message tables or sends exist yet. Following the established
recipient-removal pattern, the persistence trigger blocks accepted withdrawal
with `55000` if `public.conversations` is introduced without integrating atomic
future-send closure. The conversation feature must implement that closure before
replacing this fence. This ticket does not add a speculative messaging schema.

## Verification

- New pgTAP file first failed because the withdrawal RPC was absent.
- 221 related pgTAP assertions passed across withdrawal, request persistence,
  submission, owner decisions and recipient removal. Coverage includes privileges,
  spoofed/foreign/disabled actors, wrong flight binding, safe results, all states,
  complete-record no-op preservation, released capacity, retained history,
  same-record resubmission and unintegrated-conversation rollback.
- Nine real overlapping-transaction scenarios passed using the existing upgrade
  verifier's session and observed `pg_blocking_pids` infrastructure: duplicate
  withdrawal, both acceptance/withdrawal orders, both other-pilot acceptance/
  withdrawal orders, both resubmission/withdrawal orders, and both PRIVATE-removal/
  withdrawal orders. Assertions check semantic results, terminal state, capacity,
  record uniqueness, retained identity/note and unchanged winner snapshots.
- Prior-schema upgrade from `20261023010000` preserved the snapshot of fictional
  Auth/member/profile/flight/recipient data and an existing accepted request while
  adding the new RPC. Both explicit migration allowlists now include the migration.
- Public database types were generated from local PostgreSQL 17 and drift-checked.
  Route type generation, TypeScript, focused ESLint and diff checks passed.
- Independent review found no actionable correctness or security issues.

All write checks used owned local/disposable resources; exact race/upgrade fixture
rows were removed. No application/UI changes require browser checks in this ticket.
The full suite, unrelated upgrade races and hosted Deploy Preview verification were
not run under the project's focused-test policy. Production release verification
remains separate. No hosted migration/data/account/email/settings changes, merge,
or production publication occurred. Unrelated `AGENTS.md` and `docs/audits/` edits
are preserved and excluded.
