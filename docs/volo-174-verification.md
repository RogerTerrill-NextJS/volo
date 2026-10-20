# VOLO-174 — Flight visibility policy verification

Branch: `feature/volo-174-flight-rls`, based on merged VOLO-173 (`e0183fc`).
The user approved the bounded design in chat: verify the existing policies through
real direct data access, add focused proof gaps, and change policies only if a
concrete defect is found.

## Result

The VOLO-173 NETWORK/PRIVATE and recipient read policies met the approved
[VOLO-172 contract](volo-172-visibility-contract.md) in the tested SQL and HTTP
cases. No policy, application authorization, database schema or generated-type
change was necessary. Direct member writes remain disabled pending their guarded
mutation tickets; no posting/feed UI or new product decisions were introduced.

## Added coverage

`tests/helpers/flight-rls-cases.mjs` adds cases to the existing real Auth verifier.
It reuses the owned local stack and account/membership factories, genuine Auth
sessions, public-key PostgREST requests and the existing sanitized scenario report.
Privileged access is confined to fictional fixture setup, unchanged-state snapshots,
no-request recipient changes and cleanup. Flight/recipient fixtures are removed
before the common stack helper deletes its tracked memberships and accounts.

The five HTTP scenarios cover:

1. NETWORK/PRIVATE reads for owner, selected members, unrelated members/admins,
   disabled and unadmitted users, plus anonymous denial. A second PRIVATE flight
   catches accidental grants based on selection or ownership of a different flight.
   Direct IDs and exact counts expose only authorized flights.
2. Owner audience versus recipient-own-row access, empty unauthorized audience
   counts, nested flight/recipient relations, inner joins and HEAD counts.
3. Direct flight/recipient insert, update and delete attempts, ownership/audience
   widening, membership edits and admission upserts. Denials require the correct
   permission response and leave the owned flight, recipient and membership
   snapshots unchanged. Genuine JWTs contain spoofed member-controlled metadata.
4. Private predicates cannot be called as public RPCs and their schema cannot be
   selected through PostgREST schema headers.
5. Membership disabling and selection removal revoke access with an unchanged,
   still-unexpired JWT. Reactivation/re-addition restores only ordinary visibility;
   disabled owners also lose flight/audience reads. No request/conversation
   lifecycle is simulated, since those tables do not exist yet.

The existing pgTAP file also covers anonymous helper denial, missing subjects,
current-viewer binding, null/missing targets and forged app-metadata claims.
Existing membership, integrity and write-denial cases were reused rather than
recreated in another SQL fixture file.

## Execution and evidence

Focused command: `npm run test:flights:rls` (equivalently,
`node scripts/verify-auth-integration.mjs --flight-rls`). This uses the existing
runner/stack/cleanup path and skips unrelated compiled-application scenarios.
The normal `test:auth:integration` command includes the same flight checks, so its
existing CI job runs them without another harness or deployment job.

| Check | Result |
| --- | --- |
| Focused real Auth/PostgREST run | All five scenarios passed; owned stack cleanup succeeded |
| Flight and membership SQL, no seeds | 107 assertions passed (93 flight, 14 membership) |
| Same SQL with repository fictional seeds | 107 assertions passed |
| Deliberately broaden PRIVATE read policy in a disposable database | HTTP visibility assertion failed as expected |
| Restore original policy and repeat HTTP cases | All five scenarios passed |
| Existing generated database types drift check | Passed; generated file unchanged |
| Next route type generation and TypeScript `--noEmit` | Passed using offline public CI fixtures |
| Focused ESLint, JavaScript syntax and whitespace checks | Passed |
| Independent whole-change review | No actionable findings |

The mutation check was temporary in an owned disposable database, never a committed
migration or hosted policy change. It proved the new HTTP tests detect unauthorized
PRIVATE reads, rather than merely accepting an empty or successful response.
Both disposable stacks were removed after verification.

## Files and remaining verification

Modified: `scripts/verify-auth-integration.mjs`, `package.json`,
`supabase/tests/database/flights.test.sql`.
New: `tests/helpers/flight-rls-cases.mjs` and this note.
Unrelated AGENTS.md and docs/audits changes were preserved.

The full application suite and historical invitation/concurrency integration
scenarios were not rerun locally; CI retains those existing checks. Actual posting,
feed and detail surfaces remain with their owning tickets. Hosted Supabase data,
accounts, settings and policies were not modified. Netlify preview verification
and production migration/release verification were not performed.

No new founder decision blocks VOLO-174. Review this work before proceeding to
VOLO-175; no production deployment was requested or performed.
