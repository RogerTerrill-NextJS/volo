# VOLO-176 — Guarded flight creation

Branch: `feature/volo-176-flight-creation`, based on merged VOLO-175 (`d6bfc8c`).
The approved contract is in [the design](volo-176-creation-design.md).

## Implementation

`createFlight` is a guarded Server Action using existing origin, current membership,
completed-profile and bounded form checks. Shared validation adds a creation-only
future-departure check. The session client calls a narrow `create_flight` RPC with
eight explicit content arguments, a five-second request/body deadline and retries
disabled. Only a confirmed UUID is success; uncertain responses instruct the caller
to verify their flights before retrying. Feedback contains no raw database errors.

The additive database function derives ownership from `auth.uid()`, locks/checks
active membership then the licensed profile, and checks finite future departure
against wall-clock database time immediately before insertion. Existing constraints,
generated values and visibility RLS remain authoritative. Ordinary direct table
writes remain closed. PRIVATE creation starts owner-only without recipients, as
approved; recipient integration belongs to subsequent tickets.

## Verification

| Check | Result |
| --- | --- |
| Creation SQL plus flight, membership and profile SQL | 187 assertions passed with repository seeds; 187 passed without seeds |
| Additive migration | Owned fictional Auth, membership and profile hashes preserved |
| Focused flight/time/creation and profile validation | 19 tests passed |
| Local Auth stack helper regression | 17 tests passed |
| Real Auth, compiled native/fetched Server Actions and direct session RPC | Seven scenarios passed |
| Generated database types | Regenerated through local CLI; drift check passed |
| Next route type generation and TypeScript | Passed with non-secret local fixture configuration |
| Focused ESLint | Passed |
| Independent whole-change review | No actionable findings; reviewer did not rerun tests |

Creation tests cover member/admin ownership, missing/disabled membership, missing
profile, origin denial, protected/oversized input, past departure, retained sessions,
database eligibility revoked after application checks, private cache headers, and
malformed/lost confirmations after a commit without an automatic duplicate write.
The SQL regression checks time elapsed since transaction start. New future-time
validation, SQL function existence and action creation were observed failing before
their implementations. Tests use owned disposable loopback stacks only.

The initial compiled fixture needed typed test globals. An anonymous cache assertion
also exposed a public fixture path outside the existing cache boundary; the fixture
now posts under `/dashboard` and the original cache assertions pass. No production
cache rule changed. Future production forms must use a protected path recognized by
the existing proxy, or explicitly extend that boundary with equivalent verification.

## Modified files

- Production: `lib/flights/actions.ts`, `lib/flights/mutation.ts`,
  `lib/flights/validation.ts`, `lib/supabase/database.types.ts`,
  `supabase/migrations/20261020030000_create_flight.sql`.
- Tests/tooling: `supabase/tests/database/flight_creation.test.sql`,
  `tests/flight-creation.unit.mts`, `tests/helpers/flight-create-cases.mjs`,
  `tests/helpers/local-auth-stack.mjs`, `tests/helpers/real-auth-app.mjs`,
  `scripts/verify-auth-integration.mjs`, `scripts/verify-invitation-upgrade.mjs`,
  `package.json`.
- Documentation: this verification, approved creation design and implementation plan.

## Limits and handoff

No production UI, hosted migration/data/settings change, deployment or release was
performed. No new dependencies or database columns were introduced. No additional
founder decision is required for the approved scope. Unrelated `AGENTS.md` and
`docs/audits/` changes are preserved separately.

The full historical suite and normal combined Auth integration run were not run
locally, following the focused-testing policy. Normal Auth CI now includes the same
creation scenarios using its existing compiled app and cleanup path. No Netlify
Deploy Preview or production behavior is claimed. Verify a preview separately after
PR creation. Uncertain outcomes are deliberately not an exactly-once guarantee.
