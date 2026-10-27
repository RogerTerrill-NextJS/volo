# Beta feedback

For [VOLO-95 / VOLO-228](https://outsidethecockpit.atlassian.net/browse/VOLO-228), testers send bugs and product feedback **privately to the founder who invited them**, using their existing conversation. Roger approved this channel on 2026-10-27. Testers do not need a Jira account or another service.

## Message for testers

The inviting founder can share the following text in the existing private conversation when inviting a tester. Share it manually; this document does not send invitations or feedback.

> To report a VOLO bug or suggest an improvement, reply privately here to the founder who invited you. If something failed, tell us what you were trying to do, the steps, what you expected and what happened. Include your device/browser, roughly when it happened (with timezone), and whether you were on the live app or a preview. If useful, include the page path without query parameters and a screenshot with names, messages, email addresses and other private details covered.
>
> Never send passwords, sign-in/reset/invitation links, tokens or another pilot's private content. You don't need to retry a flight request or message just to reproduce a failure: use the app's status check if the result is uncertain.
>
> For a concern about a pilot, flight or message, use its **Report this…** action and keep the report reference. If you cannot reach the app or the report action, tell the inviting founder privately. For account deletion or a suspected security/privacy problem, tell the founder privately rather than posting the details publicly. This beta feedback channel is reviewed manually and is not an emergency or continuously monitored service.

A short report is enough to start. The founder can ask privately for missing context; testers need not discover a technical cause.

## Owners and working record

Enrique coordinates beta engagement and feedback collection; Roger triages technical bugs, reproduction and implementation effort. These follow the existing [founder roles](https://outsidethecockpit.atlassian.net/browse/VOLO-3). Whichever founder receives a message keeps its follow-up path and brings it to the appropriate owner through their existing private coordination. Roger and Enrique jointly decide product scope and launch readiness. Receiving feedback does not commit either founder to a fix or delivery date.

At each beta feedback review, use the existing restricted founder notes for the intake record below. Review new items, open clarification requests and items awaiting verification. The receiving founder remains responsible for follow-up until the handoff is acknowledged; an unacknowledged handoff stays open. No new mailbox, paid service, shared database, notification or response-time commitment is introduced.

```text
Feedback reference: local reference in restricted founder notes
Received: date/time and timezone
Owner: receiving founder; triage/handoff owner and acknowledgement if applicable
Private source: reference to the existing conversation (restricted notes only)
Kind: bug / product suggestion / help / report / deletion / security
Summary: minimal description, with private details removed
Context: environment, device/browser, approximate time, page path without query
Steps / expected / actual: as provided; mark unknowns explicitly
Impact: who is affected, what is blocked, known safe workaround
Disposition: needs context / investigating / duplicate / queued / verified / closed
Jira key or restricted routing reference: if applicable
Next action: owner and next check; no invented delivery commitment
Outcome: evidence, verified environment/revision and private follow-up status
```

Keep the original conversation and identity references in the existing restricted tools. Do not copy feedback, contact details, private flight/message content or screenshots into this public repository. Jira receives only a sanitized problem description and the minimum technical context. If Jira's audience is uncertain, keep evidence in restricted founder notes and put only the sanitized summary in Jira. A reference is not permission to read a private conversation or flight.

## Triage and Jira handoff

1. **Route first.** Bugs and suggestions follow this guide. A pilot/flight/message concern follows [founder report handling](founder-report-handling.md), including its fallback private clarification path. Account deletion follows [account-deletion operations](account-deletion-operations.md), with ownership verification and current authorized admin execution. Never process deletion as an ordinary bug or promise that a support message starts deletion. Suspected security/privacy exposure stays in restricted founder coordination with Roger; do not put exploit details, credentials or exposed personal data into ordinary Jira intake. A request for help can be answered privately without creating a bug.
2. **Clarify and deduplicate.** Roger checks existing VOLO Jira issues by affected flow and symptom before creating a bug. If steps/context are missing, record `needs context` and ask only for what is necessary. Mark an unreproduced report as unconfirmed; do not silently close it. Link duplicates to the existing issue in restricted notes and retain each tester's private follow-up reference. Do not create another issue just to count another report.
3. **Assess impact.** Potential account-access failures, lost/corrupt data, unauthorized access or blocked critical flows go to Roger for prompt assessment; security details stay restricted. Otherwise distinguish blocked tasks, degraded tasks with a safe workaround and cosmetic issues. Roger chooses the Jira priority using actual impact and existing project values. Founders agree scope changes; suggestions do not automatically become committed development work.
4. **Create actionable bugs.** Use the template below in the existing VOLO Jira project after sanitizing. Include the feedback reference only if it is non-identifying; keep any identity-to-reference mapping private. Record the resulting real Jira key back in restricted notes. Product suggestions state the tester's goal/problem and observed impact; create a Jira task only after the founders accept it for the backlog. Acknowledgement, clarification and outcome replies are manual, in the original private conversation.
5. **Verify before closing.** A merged PR is an implementation milestone. Record the PR/commit and separately record verification in its Netlify Deploy Preview using read-only behavior or owned local/disposable write fixtures. Previews share production Supabase. Production availability requires a separately requested release and actual production verification. Track an implemented item as awaiting release/verification in the next-action field until that evidence exists; do not tell a tester the live app is fixed just because a PR merged. Close with the verified outcome, or a documented duplicate/no-change decision and its reason, and record any private follow-up still needed.

### Jira bug template

```text
Summary: [affected flow] — [observable failure]
Source: beta feedback; sanitized non-identifying reference if useful
Status of evidence: reproduced / reported, not yet reproduced
Environment: production / Deploy Preview / owned local; revision if known
Device/browser: version if known
Observed: approximate time and timezone
Page: path only, no query parameters or private identifiers
Steps to reproduce:
1. ...
Expected:
Actual: safe error wording, with private details removed
Impact and safe workaround:
Duplicate search: terms checked and related issue keys
Acceptance: observable corrected behavior and relevant access/data-integrity limits
Verification: owned fixture or read-only check; environment and revision
Release/follow-up: PR and preview evidence separately from production evidence
```

Do not require logs or screenshots for every report. If more evidence is needed, Roger requests the smallest useful redacted extract. Never request credentials, a session cookie or a full database export. Do not reproduce writes against hosted beta accounts or shared preview data.

## Information handling and readiness

No tester identities or actual feedback belong in the fictional trial record. The private support conversation and notes remain subject to the approved handling/deletion procedure; this guide creates no new retention period and no automatic cleanup of external tools. When handling an authorized deletion request, review copies in founder support tools separately rather than assuming the app's deletion worker removes them. Follow the [approved deletion contract](account-deletion.md) and escalate unresolved external retention capability before claiming deletion is complete.

The documents and fictional trial establish a usable manual process. Before a tester cohort begins, its inviting founder must actually share the tester message through the existing conversation and confirm the tester can reply. That distribution and receipt are operational readiness evidence, not something this PR or a successful build proves. See the [fictional trial and verification](volo-228-verification.md).
