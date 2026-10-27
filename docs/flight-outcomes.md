# Participant-reported flight outcomes

[VOLO-229](https://outsidethecockpit.atlassian.net/browse/VOLO-229) adds optional Yes/No answers to accepted connections. Roger approved later corrections on 2026-10-27. Open **Review past flight outcomes** from the dashboard (`/dashboard/outcomes`). Leaving an item unanswered is allowed and is not treated as No. There are no reminders, automatic messages or notifications.

## Eligibility and privacy

The scheduled calendar date must have passed **in the flight's departure timezone**. Passing the departure time on that same date is insufficient. The request must still be accepted; the flight must be open or completed and unhidden; both participants must remain active; and a PRIVATE flight still requires the joining pilot's current selection. Cancellation, withdrawal, audience removal, hiding or member disablement removes the prompt and correction access. This feature does not complete a flight or restore messaging/private-flight access.

Only the authenticated posting/joining pilot can answer their own side of that accepted request. An administrator has no participant override and receives no raw outcome records. The list returns up to 20 eligible connection records with a cursor. It includes the scheduled route/date, the connected pilot's eligible display name (or an unavailable label), the connection reference and **only the viewer's own answer**. Other participants' answers and response state are not returned. Names are escaped by React; no contact details, notes or private message content are added.

Responses keep the request UUID and authenticated respondent UUID, a boolean, a revision and server timestamps. Identity and time are server-derived. The primary key prevents multiple rows for the same request/respondent. Corrections update the existing row. Differing corrections require the currently read revision; a stale tab cannot overwrite a newer different answer. Exact retries return the existing answer without moving its revision or timestamps. Writes use the same flight -> request -> ordered membership locks as the related closure operations and recheck current eligibility after lock waits.

After an uncertain response or stale correction, the form freezes and offers **Check latest answer**, a GET that reads the latest own response. After confirmed success, **Review or correct answer** also reloads before another correction. Each native form has a request-specific permalink and request-bound return state, so one connection's result cannot lock or label another connection's form. JavaScript submissions additionally prevent overlapping sends and announce/focus result feedback.

## Existing metrics source

The existing current-admin `admin_mvp_metrics` RPC and `/admin/metrics` page remain the sole aggregate report. The new response table is the participant-response source, not a second analytics event pipeline. Existing invitation/profile/post/request/acceptance/message definitions stay intact. VOLO-230 owns broader funnel verification.

| Metric | Meaning |
| --- | --- |
| Participant outcome responses | Latest Yes/No answers, one per authenticated participant per accepted request |
| Connections with at least one Yes | Distinct request IDs with one or two Yes answers |
| Connections with exactly one Yes | One Yes, with the other pilot unanswered or answering No |
| Connections with both Yes | Two Yes answers on one request; counted as one connection |
| Connections with conflicting answers | One Yes and one No; also included in exactly-one-Yes |

These are **self-reported outcomes**, not independently verified flights. A unique connection means one accepted request record, not a unique pilot pair across all flights. Acceptances and messages remain separate measures. Corrections can increase or decrease these retained-record gauges; they are not cohort conversion rates. Two No answers produce no confirmed connection; no response never implies No.

Minimal outcome references survive later closure and account deletion as retained pseudonymous history, without profile/contact snapshots. The deletion workflow retains membership/request UUID tombstones and removes protected access. This feature adds no personal free text, deletion worker, new retention period or provider-retention claim. Raw outcome table access is revoked for anonymous, authenticated and service-role callers; participant RPCs and the existing admin aggregate are the application interfaces.

## Verification and release

See [VOLO-229 verification](volo-229-verification.md). Local tests use owned disposable accounts, projects and fictional records. Elapsed calendar days are simulated on exact owned fixture flights with the persistence guard restored before authenticated operations; there is no production backdate/edit bypass.

The migration and frontend require a coordinated, separately approved release operation. The expanded metrics DTO is intentionally strict: an older metrics UI fails closed until its matching frontend is published. New outcome reads also fail safely if the migration is absent. Netlify Deploy Previews share production Supabase and do not establish schema or write isolation. No hosted migration, account/data operation or production publication is performed by this PR. Keep automatic production publishing locked.
