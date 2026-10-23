# VOLO-191 — Duplicate and concurrent request verification

Implemented on `feature/volo-191-duplicate-request-verification`, based on merged
VOLO-190 (`b22a725`). This completes the verification scope of VOLO-191 and its
parent VOLO-68 using the existing request constraint, locked submission RPC and
detail-page feedback. No production code or schema changes were necessary.

## Covered behavior

Two previously loaded detail forms submit independently over native and fetched
HTTP transports. Both receive pending feedback, one flight/requester record
remains, and its introduction comes from one of the submissions. The scenario
covers both a new request and an existing withdrawn request; resubmission preserves
the withdrawn record's UUID and creation time. Reload removes the submit form.

An explicit retry through cached form metadata leaves the entire pending record
unchanged. After fixture-controlled transitions, cached submissions report accepted
or closed feedback without changing accepted or cancelled records. These checks
exercise the existing production action, UI mapping and authenticated RPC; cached
HTML is used only to retain the actual form's action metadata.

Independent HTTP issuance exercises stale-tab behavior but does not guarantee
database overlap. The existing SQL concurrency helper separately observes the
second transaction waiting on the first using `pg_blocking_pids` before releasing
the first transaction. Its strengthened duplicate assertions verify that the
winner receives `submitted`, the waiting caller receives `already_requested`
with the same UUID and pending status, and the winning introduction and timestamps
remain unchanged. Existing recipient-removal and capacity lock scenarios continue
to pass. No new deduplication service, retry mechanism or history model is added.

## Verification

| Check | Result |
| --- | --- |
| Focused interest action/form-state units | 5 passed |
| Real Auth, compiled native/fetched actions and actual detail pages | 15 scenarios passed |
| Forced-overlap interest RPC lock scenarios | 5 passed |
| Modified helper syntax, focused ESLint and diff checks | Passed |
| Independent review | No actionable findings |

The added scenario runs through the existing interest integration runner and CI
path. The strengthened lock helper is already invoked by the database upgrade
verification path. The local lock run used that helper with the existing upgrade
verifier's SQL/session/barrier primitives against disposable PostgreSQL 17.

Only targeted checks were run under the MVP test policy. The full historical
suite, full upgrade verifier and hosted Netlify preview were not run. No fresh
manual browser check was needed because this ticket changes test coverage only.
The owned local Auth/app fixture and database were cleaned up after verification.

Hosted preview verification and production release verification remain separate.
No hosted data, migration application, merge or production publishing occurred.
Automatic production publishing stays locked. Unrelated `AGENTS.md` and
`docs/audits/` changes are preserved and excluded.
