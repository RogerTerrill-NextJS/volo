# VOLO-219 — Recipient-only notification persistence

Base: merged VOLO-218 (`5e9a57d`). `public.notifications` retains a server UUID/time, recipient membership, one of three MVP event types, a canonical event key, exactly one typed request/message reference and an initially null read marker. Restrictive foreign keys preserve history. No message body, profile/post snapshot, arbitrary URL, duplicate unread counter or delivery payload is stored.

Only the current active recipient can SELECT; an administrator has no override. Anonymous/member/service-role direct writes and service-role reads are closed. The unexposed private persistence trigger derives the correct recipient from the source: flight owner for pending interest, requester for acceptance, opposite immutable participant for messages. It validates source state/target shape, freezes request/message source identity through commit, fences active recipient membership, rejects a supplied foreign recipient and forces canonical event/time/unread metadata. Updates remain closed before the later guarded mark-read implementation.

Recipient/event-key uniqueness makes an exact retry a no-op preserving the original row/time. Request keys bind the event type, request UUID and its existing server `status_changed_at`, so an eligible same-record resubmission and a later acceptance are distinct occurrences. Message keys bind the immutable message UUID. Notification references grant no target read permission: removed PRIVATE recipients retain their own notification history without recovering post visibility.

## Handoff to the owning operations

VOLO-219 does not generate or backfill notifications. VOLO-220 must insert inside the corresponding guarded SQL operation transaction, after the successful state change/message insert, using only the source reference. For example:

```sql
insert into public.notifications(event_type,request_id)
values ('request_received', request.id)
on conflict(recipient_id,event_key) do nothing;
```

Use `request_accepted` for acceptance, or `message_received` with `message_id` for a new message. The BEFORE trigger fills recipient/event key/time before constraints are checked. Do not create a public writer or issue a separate service-role insert after the operation. Existing source/membership locks and validation remain authoritative; notification persistence does not authorize a request, message or destination. VOLO-221/222 own recipient query/view, guarded mark-read behavior and destinations that recheck current access. There is no generic rules engine, event bus, worker, email or push delivery.

## Verification

- The new SQL contract first failed on an owned baseline with missing notification persistence, then passed after the migration was applied only to that disposable database. Final verification passed all 146 checks across notification persistence and existing message-permission/request contracts, including both message directions, no generation before VOLO-220, valid target combinations, wrong/disabled recipients, exact retry chronology, distinct resubmission/reacceptance occurrences, recipient/admin/anonymous isolation and retained PRIVATE references without target access.
- All 21 targeted infrastructure/upgrade-guard checks passed. The existing upgrade verifier now includes both migration-history entries and reuses its SQL sessions for a concurrent identical-event insertion. The competing insert was observed waiting on the original transaction; both resolved to one original ID/time/key and one retained row.
- Public database types were generated from the owned migrated database. The common disposable-stack cleanup clears notifications before retained membership/source relationships. No new harness, job or app-role writer was introduced.
- Independent read-only review found no actionable defects in source/recipient binding, active-recipient RLS/grants, lock compatibility, retry identity, retention or verifier integration. Route generation, TypeScript, focused lint and diff checks passed. All disposable verification resources were cleaned up.

The full suite, unrelated SQL matrices and destructive prior-schema upgrade were not repeated under the MVP policy. No product screen changed, so browser interaction was not needed for this persistence ticket. Fresh CI/Netlify Deploy Preview verification remains separate and pending. No hosted migration application, accounts/data/email/settings changes or production publication occurred.
