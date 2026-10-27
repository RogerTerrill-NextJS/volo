# VOLO-229 — Verification

Base: merged VOLO-228 (`c9eb27c`). Implements VOLO-229 / VOLO-96 with the user's 2026-10-27 decision to allow corrections. [Behavior, privacy and metric definitions](flight-outcomes.md) describe the local-date eligibility, current accepted-pair checks, own-answer projection and retained aggregate semantics. [Implementation plan](plans/2026-10-27-volo-229-flight-outcomes.md) records the chosen approach. No hosted mutation or production publication was performed.

## Targeted evidence — 2026-10-27

| Check | Result |
| --- | --- |
| New outcome SQL | **58 passed**: optional state, current pair/PRIVATE/member/status guards, same-date/timezone boundaries, own-only projection/raw-table denial, corrections/revision/retry integrity, pagination and one/both/conflicting aggregate counts |
| Existing metrics SQL | **26 passed** |
| Existing connection/withdrawal/cancellation SQL | **104 passed**: 31 / 37 / 36 |
| Outcome/metrics and existing connection query units | **20 passed** |
| Existing real Auth/app harness, `--flight-outcomes` | **3 scenarios passed** with actual local Auth/PostgREST and compiled native/fetched product forms |
| Type generation / TypeScript | Passed using the owned local schema and non-production fixture build configuration |
| Focused ESLint / diff / local documentation links | Passed; 12 local links checked |
| Strict CI upgrade history | Compared with all **39** committed migrations; empty/unknown histories still rejected; historical baseline unchanged |

The three real-service scenarios verify:

1. Future flight denial; after-date private-pair eligibility; escaped connected-pilot labels; actual native/fetched saves and corrections; other participant sees only their own answer; aggregate count changes; actual admin metrics rendering without private flight details.
2. A deliberately discarded committed response; frozen uncertain feedback followed by a fresh GET of the exact connection's saved answer; an identical retry preserving revision/time; stale differing correction rejection; concurrent opposing first answers producing one saved row and one stale result.
3. Wrong-origin direct action denial without writes; unrelated admin denied participant access; raw table denial; counterpart disablement and PRIVATE removal fencing cached forms; retained aggregate evidence; concurrent correction versus withdrawal and rejection of subsequent corrections.

The dedicated group is also reused at the end of the existing member/flight/report administration integration command. No duplicate test stack or runner was introduced. The new unit cases are included in the existing flight-unit command. Existing report integration expectations now use the new participant-outcome heading; its broader scenarios were not rerun locally.

## Review and corrections

Independent whole-change review found one material issue: every list item used the same native `useActionState` permalink. An isolated test against the installed React server renderer reproduced one postback setting both differently keyed items to saved. Each form now uses a request-specific fragment permalink and filters returned state by request ID. The compiled native integration regression verifies that saving one item leaves the second connection's form editable and shows no saved feedback on that second item. No further material findings were reported. The reviewer independently ran ten outcome/metrics unit checks; database and real-service evidence above was produced by the implementing agent.

During verification, type generation initially lacked the required public fixture configuration; rerunning with non-production build values exposed and resolved an optional RPC argument type mismatch. The integration fixture's Auth call was corrected to use the Auth API's promise result rather than PostgREST's retry method. Recovery assertions now compare the exact rendered connection and ignore React's HTML text-separator comments. These fixture fixes did not relax application guards or redefine a successful save.

## Limits and operations

No full test suite, fresh hydrated browser/device/keyboard pass, hosted write, hosted migration or production release was performed. UI evidence is compiled product-route HTML and actual native/fetched Server Action execution; it does not certify every browser interaction. Local time elapse uses fixture backdating rather than waiting days, and the closure race is a real overlapping-operation check rather than proof of every scheduler ordering. The broader invitation-to-outcome funnel remains VOLO-230.

Owned fixture resources are cleaned up after their runs. A Netlify build is not proof that the production schema includes the new migration or that outcomes are live. Coordinate the reviewed migration and matching frontend in a separately requested release: older metrics DTO consumers fail closed during the transition. Record preview verification separately from production verification and preserve locked automatic production publishing.
