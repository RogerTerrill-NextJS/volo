# VOLO-178 — NETWORK / PRIVATE posting selection

Branch: `feature/volo-178-flight-visibility`, based on merged VOLO-177 (`7b8bce4`).
The user requested PR creation after the bounded design was presented, authorizing
implementation of that scope and the PR. Installed Next.js forms/data-security
guides were reviewed. Existing creation validation, RPC and RLS support both modes.

## Scope and behavior

Replace the fixed NETWORK form with accessible NETWORK / PRIVATE radio choices.
Require an explicit selection; do not silently default to public posting. Preserve
an approved choice after field errors, and show audience-specific confirmation.
Pass the selected value through the existing guarded creation action instead of
replacing it with NETWORK. Existing validation rejects missing/invalid/GROUP modes.
No database migration, policy change or dependency is required.

PRIVATE remains owner-only at this intermediate step, as stated in the proposed
scope and prior creation design. The form explains that no other pilots have been
selected and shows additional audience guidance only when PRIVATE is chosen.
VOLO-179 supplies authorized recipient operations; VOLO-180 supplies the actual
picker. This ticket does not add a nonfunctional picker or claim selected-pilot
sharing is complete. The recipient-selection portion of the original VOLO-178
wording is handed off to those explicit owning tickets.

## Verification

| Check | Result |
| --- | --- |
| Form-state checks against prior implementation | Expected PRIVATE-retention failures before implementation |
| Real native form against prior implementation | Expected failure: native validation did not preserve PRIVATE |
| Flight/time/creation/form-state/profile units | 22 tests passed |
| Focused real Auth and compiled native/fetched HTTP checks | 11 scenarios passed |
| Next route type generation / TypeScript | Passed with non-secret local fixture configuration |
| Focused ESLint and diff checks | Passed |
| Independent whole-change review | No actionable findings; reviewer independently passed 3 form-state units |
| Hydrated Chrome at 390 × 844 | No horizontal overflow; native radio keyboard navigation, conditional guidance, retained choice and PRIVATE confirmation verified |

The existing native/fetched publication case now checks both NETWORK and PRIVATE,
one owner-derived row per call, and genuine session-client reads: the owner sees
both modes, while an unrelated active admin sees NETWORK and no PRIVATE row.
PRIVATE publication creates no recipients at this step. Native validation preserves
the selected PRIVATE radio. Missing, blank, GROUP, lowercase and arbitrary modes
are rejected through both transports without inserting a flight or calling the RPC.
The initial form has exactly two radio choices and neither is selected by default.
All original eligibility/origin/uncertain-write scenarios also passed. The owned
HTTP stack was cleaned successfully.

The owned browser fixture started with neither radio selected. ArrowRight moved
the choice from NETWORK to PRIVATE and displayed private-audience guidance;
switching back to NETWORK hid it. A client validation error retained PRIVATE and
focused the alert summary. A valid submission showed the owner-only confirmation
and created one PRIVATE row. The viewport override was restored. Local evidence:
`/private/tmp/volo-178-mobile-private.png`.

## Modified files

- `app/(protected)/dashboard/flights/new/actions.ts`: pass the submitted mode.
- `app/(protected)/dashboard/flights/new/flight-form.tsx`: explicit accessible choice
  and conditional PRIVATE guidance.
- `app/(protected)/dashboard/flights/new/page.tsx`: audience-neutral introduction.
- `lib/flights/form-state.ts`: retain only approved modes and audience-safe feedback.
- `tests/flight-form.unit.mts`: retained choice and audience confirmation checks.
- `tests/helpers/flight-create-cases.mjs`: both-mode posting, invalid-mode denial and
  unrelated-member isolation through genuine session clients.
- `tests/helpers/real-auth-app.mjs`: omit undefined test fields to exercise missing
  visibility through the existing native/fetched action transports.
- `docs/volo-178-verification.md`: this record.

## Limits

All write checks use owned disposable local resources. No hosted accounts, data,
email or settings changes, production publication or release is part of this work.
Netlify preview verification remains separate. Full historical and unrelated SQL
suites are not run locally under the repository's focused-test policy; normal Auth
CI reuses the extended scenarios. Unrelated AGENTS.md and docs/audits changes remain
outside this work.
