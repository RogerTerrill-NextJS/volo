# VOLO-177 — Mobile flight form and publish result

Branch: `feature/volo-177-mobile-flight-form`, based on merged VOLO-176 (`678807f`).
The user approved the bounded design in chat. VOLO-60 is Done; VOLO-176 is merged.
Installed Next.js form and data-security guides were reviewed before application edits.

## Implementation

The protected `/dashboard/flights/new` page checks current membership and completed
profile before offering the form. Completed-profile members can reach it from the
dashboard. Both the page and its action responses inherit the existing private-cache
boundary for `/dashboard/**`; the Server Action independently rechecks access.

The mobile form collects departure/destination airports, local date/time, an explicit
named timezone, aircraft, joining-pilot places excluding the owner, and optional notes.
It explains ambiguous/nonexistent local times and supports the existing earlier/later
occurrence choice. Shared creation validation runs in the client and authoritative
server operation. Device timezone does not silently determine departure timezone.

This form explicitly publishes to NETWORK. Its Server Action wrapper fixes that
value and delegates to VOLO-176's guarded creation action. Visibility selection and
private recipients remain in VOLO-58/59. No database changes or dependencies were added.

Feedback uses labels, linked field errors, focusable summaries, status announcements
and pending controls. Failed native submissions retain only bounded editable values;
protected fields and action metadata are not echoed. A synchronous submit guard and
pending controls prevent ordinary double submissions. Confirmed success removes the
form and shows a flight reference with an explicit option to post another flight.

An unavailable/internal result preserves bounded values and disables immediate
resubmission, with a warning to verify publication before trying again. A route error
boundary gives the same caution when the action response itself cannot be delivered.
Neither branch automatically retries or claims that a possibly committed write failed.

## Evidence

| Check | Result |
| --- | --- |
| New form-state behavior tests against initial stub | Two expected failures before implementation |
| Flight/time/creation/form-state and profile units | 21 tests passed |
| Focused real Auth and compiled native/fetched HTTP integration | Ten scenarios passed |
| Next route type generation / TypeScript | Passed using non-secret local fixture configuration |
| Focused ESLint | Passed |
| Independent whole-change read-only review | No actionable findings |
| Hydrated Chrome at 390 × 844 | No horizontal overflow; validation/uncertain summaries focused, keyboard order and double-click guard verified |

The three new HTTP scenarios verify actual page access/profile gates and no-store
headers, native DST-error recovery with retained values and accessible errors, native
and fetched publication with one owner-derived NETWORK row, and a committed but lost
response with retained values, a disabled form and one RPC call. They extend the
existing owned Auth/compiled-app fixtures and run in normal Auth CI; no new harness
or hosted write tests are introduced. The seven existing creation-security scenarios
also passed. Disposable HTTP resources were cleaned successfully.

Browser verification used a separate owned disposable account and the same compiled
app helper with production styles. Empty submission focused its linked error summary;
a repeated local departure required an explicit occurrence. Keyboard Tab moved from
the occurrence selector to aircraft. Double-clicking Publish produced one NETWORK
row and a confirmed result with no remaining submit form. A subsequent deliberately
discarded committed response focused the warning and disabled the retained fields.
The viewport override was restored. Local screenshots:
`/private/tmp/volo-177-mobile-success.png` and
`/private/tmp/volo-177-mobile-unconfirmed.png`.

## Modified files

- `app/(protected)/dashboard/flights/new/page.tsx`: protected page and profile gate.
- `app/(protected)/dashboard/flights/new/flight-form.tsx`: responsive accessible form.
- `app/(protected)/dashboard/flights/new/actions.ts`: fixed-network guarded publication.
- `app/(protected)/dashboard/flights/new/error.tsx`: uncertain-result error boundary.
- `app/(protected)/dashboard/page.tsx`: completed-profile posting entry point.
- `lib/flights/form-state.ts`: bounded editable feedback and confirmed/uncertain states.
- `tests/flight-form.unit.mts`, `tests/helpers/flight-create-cases.mjs`,
  `tests/helpers/real-auth-app.mjs`, `package.json`: focused checks and existing fixture reuse.
- `docs/volo-177-verification.md`: this record.

## Limits and decisions

No remaining founder decision blocks this approved scope. No hosted accounts, data,
email or settings were changed. No deployment, production publication or new PR was
performed. A later flight browsing workflow supplies flight-list navigation; this
ticket does not invent a detail route or imply exactly-once creation across replayed
requests or browser tabs. Ordinary double-click prevention is a UI safeguard.

The full historical suite, unrelated SQL suites and combined Auth runner were not run
locally under the repository's focused-test policy. Netlify preview and production
verification remain separate. Unrelated `AGENTS.md` and `docs/audits/` changes are preserved.
