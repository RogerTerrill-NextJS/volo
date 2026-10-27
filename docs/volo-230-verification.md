# VOLO-230 — Existing invitation-to-outcome MVP funnel

Verified scope: [VOLO-230](https://outsidethecockpit.atlassian.net/browse/VOLO-230), step 2 of [VOLO-96](https://outsidethecockpit.atlassian.net/browse/VOLO-96), using the VOLO-88 report after merged VOLO-229 (`203af0b`). This work extends existing verification fixtures and documents interpretation. It adds no application behavior, database migration, event collection, dashboard or second analytics pipeline.

## Source and interpretation contract

The sole report is `admin_mvp_metrics` through the server-only query and `/admin/metrics`. The original aggregate query is extended by the existing [outcome migration](../supabase/migrations/20261106010000_flight_outcomes.sql). The [report query](../lib/metrics/query.ts) validates the fixed aggregate DTO and rechecks the same current admin identity/role before returning it. The [existing report page](../app/(protected)/admin/metrics/page.tsx) labels each population. No individual report drilldown or additional source-table grant is introduced.

| Report field | Authoritative source and boundary |
| --- | --- |
| Invited pilots | Distinct normalized invitation recipients with an accepted provider send receipt or accepted reconciliation; retries/case variants deduplicate. This measures provider acceptance, not inbox delivery or an invitation being read. Failed sends do not contribute. |
| Activated pilots | Distinct Auth subjects on redeemed invitations. An admitted/bootstrap member or a sign-in alone does not establish this milestone. |
| Active members | Currently active memberships, including bootstrap/direct admissions; disabled members are excluded. This is a current gauge, not lifetime signup count. |
| Completed profiles | Retained schema-valid profile rows, including disabled history. Required profile fields are enforced on save; a photo is not a required completion milestone. |
| Active profiles | Retained profiles with currently active membership. |
| Flight posts | Retained unique flight rows, including PRIVATE, hidden, cancelled or completed posts. |
| Interest requests | Unique flight/requester records across all states. Withdrawal and eligible resubmission reuse one record. |
| Current accepted requests | Current `accepted` status; can decrease after withdrawal/cancellation. |
| Requests with recorded acceptance | Distinct requests currently accepted or evidenced by an acceptance notification or conversation. Reacceptance counts once. Earlier closed requests without preserved evidence cannot be reconstructed. |
| Messages | Unique retained message rows; exact send retries count once. |
| Conversations with messages | Distinct conversations with at least one message; neither messaging nor acceptance proves a flight occurred. |
| Participant outcome responses | Latest authenticated Yes/No answer per request/respondent, not number of submission attempts. |
| Connections with at least one Yes | Distinct accepted-request IDs with one or two Yes responses; participant-reported, not independently verified flying. |
| Connections with exactly one Yes | One Yes, other participant unanswered or No. Unanswered does not mean No. |
| Connections with both Yes | Two Yes responses on one request; counted as one connection. |
| Connections with conflicting answers | One Yes and one No; a subset of exactly-one-Yes, without automatic adjudication. |

A unique connection is **one accepted request record**, not a unique unordered pilot pair across all flights. Corrections reuse response rows and can move a connection between the one/both/conflicting counts. Minimal historical outcomes remain after later closure, while current eligibility continues to fence participant reads/corrections. See [outcome behavior and privacy](flight-outcomes.md).

These totals mix retained history and current gauges. They do **not** share a single cohort or denominator: invitation recipients, activated subjects, profiles, flights, requests, message rows and outcome respondents are different populations. Do not turn their ratios into signup-to-flight conversion, add one/both/conflicting counts together, or subtract unrelated totals to infer abandonment. Founder interpretation stays manual during beta.

No browsing event or page-view counter is collected by this report. Reading a page changes none of its source milestones. If browsing signals are collected separately in future, treat them only as directional interest, not activation, acceptance, messaging or evidence that pilots flew together. This ticket adds no browsing instrumentation.

## Representative-record verification

The existing [metrics SQL contract](../supabase/tests/database/mvp_metrics.test.sql) now continues from invitations through outcomes in one transaction. It captures an authenticated baseline before adding its fixture, then compares **every numeric field and the outcome marker together** with the real report response. It is run both without seeds and with the repository's fictional seeds. No empty-database assumption or production account is needed.

The fixture includes repeated case-variant invitation recipients with accepted/reconciled sends, a failed send, one redeemed invitation, active/disabled/directly admitted identities, complete active/disabled profiles, PRIVATE flight posts, withdrawal/resubmission/reacceptance, a repeated exact message send, and two accepted requests for the same two pilots on different flights. It uses ordinary participant outcome RPCs after simulating elapsed dates on those exact fixture flights; the material-edit guard is restored before authenticated operations.

| Full-snapshot field | Expected fixture contribution above captured baseline |
| --- | ---: |
| Invited pilots | +2 |
| Activated pilots | +1 |
| Active members | +2 |
| Completed profiles / active profiles | +2 / +1 |
| Flight posts / interest requests | +2 / +2 |
| Current accepted / recorded accepted requests | +2 / +2 |
| Messages / conversations with messages | +1 / +1 |
| Participant outcome responses | +3 |
| Connections with at least one Yes | +2 |
| Exactly one Yes / both Yes / conflicting | +1 / +1 / +0 |

The baseline already contains the fixture's inspecting admin; subsequent directly admitted active members contribute to the active-member gauge without inventing redeemed invitations. The fixture's two completed profiles include one disabled member. These differences deliberately demonstrate why the report is not a same-cohort conversion funnel.

Before any outcome response, accepted requests, messages and passed scheduled dates contribute **zero** confirmed outcomes. One Yes yields one response/connection/exactly-one-Yes. An opposite No adds a response and a conflict, not a second connection. Correcting that No to Yes produces both-Yes, clears the conflict and keeps two response rows. A Yes on the second request yields two distinct reported connections despite the repeated pilot pair. An exact retry preserves receipt, revision and timestamp.

The existing [real-service outcome scenarios](../tests/helpers/flight-outcome-cases.mjs) additionally compare acceptance-stage and one-Yes-stage aggregates against their own populated-stack baseline. They read the actual compiled `/admin/metrics` page and compare all **16 rendered labels/counts** with its real aggregate response. Existing native/fetched saves, corrections, privacy, lost-response recovery, competing first answers and closure checks remain in that same harness. This is not a new runner or metrics implementation.

## Evidence — 2026-10-27

| Verification | Completed result |
| --- | --- |
| Existing metrics SQL contract, no seeds | **44 passed** |
| Same contract with repository fictional seeds | **44 passed** |
| Existing outcome SQL contract with seeds | **58 passed** |
| Existing outcome/metrics units | **10 passed** |
| Existing real Auth/app outcome group | **3 scenarios passed**, including all 16 rendered label/count comparisons |
| Focused fixture ESLint / whitespace / documentation links | Passed; 8 local links checked |

SQL results were read and checked for the exact pgTAP plan and absence of failed assertions, using the existing owned-stack helper and local `psql`. No additional runner was committed. The existing commands `node --conditions=react-server --test tests/mvp-metrics.unit.mts tests/flight-outcomes.unit.mts` and `node scripts/verify-auth-integration.mjs --flight-outcomes` supplied unit and real-service evidence. The latter compiled the actual product routes before running its scenarios. Both owned local stacks and their fixture accounts/rows/work directories were cleaned up successfully; no cleanup failure was recorded.

Independent whole-change static review found no concrete issues in fixture arithmetic, source semantics, privacy checks or interpretation. The reviewer relied on the completed run results above rather than independently rerunning services.

SQL fixtures represent valid persisted states; they do not send real invitations or prove provider delivery. Real-service scenarios use disposable local Auth/PostgREST and actual product report/forms, not hosted beta data.

## Limits and release boundary

No production/beta usage totals, hosted migration or data/account/email/settings operation, new tracking service, tester contact or production publication is performed. Preview and production verification remain separate. The previously implemented migration/frontend still require their separately approved coordinated release; this verification PR does not establish that they are live.

The full suite, production-scale performance benchmark, fresh hydrated browser/device pass and cohort/conversion analytics are outside this targeted verification. Fictional redeemed/send records establish the report's source semantics, not end-to-end email delivery, password establishment or real-world flight truth. Those lifecycle behaviors retain their existing independent tests. Keep automatic production publishing locked.
