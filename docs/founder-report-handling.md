# Founder handling of beta reports

VOLO uses manual report intake and the existing founder-admin controls during beta. The founder explicitly chose reports and founder-admin handling for the MVP; personal blocking is not part of this flow. There is no case-management engine, automatic moderation, report resolution state or report-triggered notification. Check `/admin/reports` regularly as part of beta operations; submission alone does not alert another service or person.

For general product feedback, bug reports and help, use the [beta feedback process](beta-feedback.md). Contextual pilot/flight/message concerns continue through this report procedure.

## Intake and review

1. Sign in with your current active administrator membership and open **Reports** in app navigation (`/admin/reports`). The list is ordered by report UUID, not received time. Follow **Next reports** to review all pages; each page contains at most 50 records. There is no unread marker or assigned queue.
2. Record the report reference, reporter member ID, target kind/ID and received time in your existing restricted founder notes. Treat the reason as an allegation needing context. Reports are immutable evidence of what the reporter submitted, not proof that the target violated a rule.
3. Examine only information you are entitled to read. A pilot or flight reference may be unavailable after membership, PRIVATE audience or moderation changes. An admin role does not restore ordinary PRIVATE-flight access. A message report gives a message ID and the reporter's own description; it does not copy the message body or grant access to the conversation. Do not use service-role credentials, raw SQL or another pilot's account to bypass those limits. If necessary, ask the reporter for the minimum additional context through an already agreed private support channel. This feature does not create or send that communication.
4. Compare the report with the relevant beta participation expectations and available context. Consider whether a clarification, no action, member disable or flight hide is warranted. Confirm the correct target independently: a message ID is not a member ID, the reporter is not automatically the reported pilot, and a reported flight's owner must be established from authorized evidence.

## Take and verify an action

- **Member controls** (`/admin/members`) can disable a specific member after an explicit reason and confirmation. Disable removes protected access while retaining the Auth account and related records. It is not account deletion, personal blocking or a role change; self-disable is prohibited. Do not act against the reporter simply because their ID is displayed on a report.
- **Flight moderation** (`/admin/flights`) can hide a specific flight with an explicit reason and confirmation. Hiding retains the post and audit record, closes active requests and future conversation sends under the existing rules, and preserves permitted participant history. The owner retains the hidden record; other pilots cannot recover hidden post details through a report reference. There is no app unhide operation.
- Check the action's confirmed result and the current retained member/flight record. If the result is uncertain, use its explicit status check before considering another action. A merge or preview build is not evidence of a production moderation result.
- Record your decision, evidence limits, report reference, action target, time and the existing audit reference in restricted founder notes. For no action, record why. Intake rows remain unchanged; the application does not label reports as resolved, notify the reporter or provide a response-time guarantee. Communicate an appropriate outcome only through an approved support channel, without disclosing other pilots' private information.

## Reporter experience and retention

A pilot opens a readable profile, flight or message and chooses **Report this…**. `/reports` also explains this path. The required reason is limited to 2,000 Unicode characters. A confirmed receipt supplies a report reference. Lost or malformed confirmations freeze further sends and provide **Check report status**, which reads only that member's existing receipt; it does not resubmit. An exact UUID/payload retry cannot create another row. New submissions still require current target eligibility, while an active reporter can confirm their existing receipt after losing target visibility.

Reports remain readable only by their current active reporter and current active administrators. Administrators' member-facing receipt recovery is limited to their own submissions. Disabled reporters lose protected reads; demoted or disabled administrators lose the founder view. Reports retain target references without target-content snapshots and do not cascade away with target deletion. The reporter reference restricts deletion of the membership. This ticket adds no retention deletion job or new export; any retention/deletion operation needs a separately reviewed procedure.

## Release boundary

Use local disposable fixtures for write verification. Netlify Deploy Previews share production Supabase and are not a safe place for test reports, member disables or flight hides. Verify preview rendering/read boundaries separately from authorized production operation. Keep production publishing locked and publish only a user-requested release batch. The VOLO-217 report-intake migration must be applied through its approved hosted migration operation before the production intake is functional; this UI ticket does not apply it.
