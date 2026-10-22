# VOLO-190 — Interested UI and request feedback

Implemented on `feature/volo-190-interest-ui`, based on merged VOLO-189
(`1ca5fc2`). The user approved the bounded design and requested a PR. The installed
Next.js forms, Server Actions and data-security guides were reviewed. The existing
VOLO-189 submission policy/RPC remains the mutation authority; no schema changes,
new submission API or privileged application client are introduced.

## Behavior

Flight detail uses its joining-pilot action slot for an accessible Interested form.
The optional introduction is limited to 500 Unicode code points, matching SQL.
The counter, associated label/help, native validation, progress status, disabled
pending controls and visible keyboard focus accompany the existing guarded action.
The DOM maximum length allows 500 supplementary-plane characters; the client and
server independently enforce the actual 500-character business limit.

The new detail action wraps the existing mutation policy and maps only fixed safe
feedback into bounded form state. It rejects authority fields and never reflects
provider errors or caller-supplied state messages. Successful or duplicate pending
requests show pending feedback and remove the submission form; accepted requests
show their accepted state. Withdrawn requests may resubmit on the same record under
VOLO-189's checks. Declined/cancelled requests remain closed. No acceptance,
withdrawal, conversation or notification controls are added here.

Own, past, cancelled and completed flights have no submit control. Missing-profile
pilots receive a direct `/onboarding` link, consistent with posting. Full flights
are rejected by the existing locked RPC when submitting; the page does not count
or expose other pilots' accepted requests or mislabel total capacity as remaining
places. Safe unavailable/full feedback removes the form until status is reloaded.

Validation errors retain a bounded introduction for correction. Unknown or lost
write confirmations preserve the draft, focus an error alert, disable resubmission
and offer a native **Check request status** navigation. Reload reads the actual
request; a committed write then appears pending. Automatic write retries remain
disabled. Native and fetched submissions use the same protected mutation boundary.

## Read and access boundary

`getOwnFlightInterest` reads the existing request through the viewer's session,
filtering by both the flight UUID and verified requester identity. It validates
those bindings and the legal state, and projects only the state/profile-completion
result. It never enumerates owner-side incoming requests or joins another pilot's
request data. Malformed or failed status reads disable submission.

After reading retained request history, it rechecks the flight through live flight
RLS and rechecks active membership/viewer identity. Lost PRIVATE selection produces
the existing missing-flight response, including when the pilot retains their prior
request. Authorization/service failures discard the detail response; a request-only
outage shows safe status-reload feedback while verified visible flight details
remain readable. Every mutation still independently repeats access and eligibility
checks; presentation is not an authorization grant. Existing private/no-store
response behavior and disabled link prefetching are retained.

## Verification

| Check | Result |
| --- | --- |
| Query and form-state tests before implementation | Six expected missing-behavior failures against initial stubs |
| Focused query/form/input/detail/mutation units | 25 tests passed |
| Real Auth, compiled native/fetched actions and actual detail pages | 14 scenarios passed |
| Existing feed/detail/visibility regression scenarios | 11 passed |
| Native no-JavaScript boundary correction | Oversized Unicode note rejected; correction to 500 emoji accepted |
| Route type generation, TypeScript, focused ESLint and diff checks | Passed |
| Independent review, including final onboarding recovery | No actionable findings |

New integration cases cover complete submission from the actual detail form,
pending status after reload, owner/lifecycle/profile gating, loading onboarding from
the guidance link, validation recovery, withdrawn resubmission, accepted/closed
feedback, full-flight rejection, lost-confirmation blocking, and request-status
outage/recovery. A forged action against an inaccessible PRIVATE flight creates no
request and reveals no detail canary. Selection removal preserves cancelled request
history while the actual page remains inaccessible. The prior eight guarded RPC/
action scenarios continue to pass. Cases extend the existing owned local Auth/app
fixture and CI path; no duplicate harness or hosted writes are used.

The profile recovery check caught a navigation assumption during development:
missing profiles use onboarding, while the existing edit page redirects there.
The CTA now targets onboarding directly and the check loads its actual form.
No access guard or assertion was weakened to resolve it.

## Manual browser evidence

Used the existing compiled real-Auth fixture with production CSS and fictional
local pilots/flights. The viewport override was reset and the browser tab, app,
fictional accounts, database and temporary fixture were cleaned up afterward.

- 390px form: no horizontal overflow, 48px Interested button and 2px solid keyboard
  focus outline; textarea label/help and counter present in the accessibility tree.
- 501 characters produced native invalid feedback; 500 emoji counted as 500 and
  remained valid. The counter updated correctly when replacing the draft.
- Tab from the introduction reached Interested; Enter submitted it. Progress was
  exposed and success moved focus to the pending confirmation, removing the form.
- Reload retained pending feedback. At 320px both form and feedback stayed within
  the viewport, including eight-character airport identifiers.
- A simulated lost response retained the draft and count, focused `role=alert`,
  disabled the textarea/button, and offered Check request status. Activating it
  recovered the committed pending state without another submission.

These are desktop Chrome viewport/keyboard checks, not physical iPhone/Safari or
screen-reader certification. The full historical suite and hosted Netlify preview
were not run under the MVP focused-test policy. No database tests were added or
rerun separately because this ticket changes no schema or RLS; integration used
real PostgreSQL with all current migrations.

Hosted preview verification and production release verification remain separate.
No hosted accounts/data/email/settings, migration application, merge or production
publishing occurred. Automatic production publishing stays locked. Unrelated
`AGENTS.md` and `docs/audits/` changes are preserved and excluded.
