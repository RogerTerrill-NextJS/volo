# VOLO-221 — Recipient notifications and explicit read markers

Base: merged VOLO-220 (`4c89b80`). The protected Notifications page shows only the active recipient's records, newest first with 20-row timestamp/UUID keyset pages. It displays generic request, acceptance and message labels, UTC chronology and explicit unread/read states. Viewing never marks a record. Empty, invalid-page, loading and service-error states are safe and actionable. Private response cache policy includes the new route.

Each unread row exposes a guarded native/fetched action to `mark_notification_read`. The operation derives identity from the verified session, fences current membership, locks only a recipient-owned notification and sets its first server timestamp. Retries return that original marker. Foreign/missing records share one unavailable outcome; administrators have no override. Direct writes remain closed. The private trigger permits only the initial marker and rejects changes to recipient, event/source identity, creation time or an existing marker.

The page uses the ordinary session client, validates returned recipient bindings and pagination/chronology, returns a minimal DTO and rechecks access before releasing rows. No service-role read, source-content enrichment, implicit marking, unread counter or delivery framework is added. Target navigation remains VOLO-222; records do not grant access to their source.

## Verification

- The new mark-read SQL contract failed against the merged disposable baseline, then passed after applying the migration only locally. **366 checks across nine related SQL files passed**, including recipient/nonrecipient/admin isolation, disabled and missing sessions, closed direct grants, metadata immutability, stable retry markers and existing notification generation/source permissions.
- Existing owned PostgreSQL barriers observed both notification uniqueness contention and a concurrent mark-read row-lock wait. Competing marks returned the same first read timestamp.
- **13 focused unit checks passed** for notification query/mutation, private cache-path policy and shared mutation authorization/input/origin behavior. **21 infrastructure/upgrade-guard checks passed.**
- Public database types were generated from the migrated owned database. Route generation, TypeScript, focused ESLint, whitespace and existing client/server boundary checks passed.
- A fresh independent read-only review found no actionable implementation defects. Target navigation and production deployment were explicitly outside this ticket's implementation review.

**59 signed-in integration scenarios passed** in the existing request/message fixture. Three added scenarios prove recipient-only native/fetched marks and immutable refresh state, foreign-user/admin denial, missing-origin denial, read-outage recovery and ambiguous committed-write recovery. Existing request/chat/withdrawal/decision/cancellation/edit behavior stayed green. Local styled browser verification confirmed the navigation entry, loading/unread state, explicit marking with a deliberately lost committed receipt, safe reload feedback, and the persisted read state after reload. Evidence: /tmp/volo-221-notifications-unread.png, /tmp/volo-221-notifications-unconfirmed.png and /tmp/volo-221-notifications-read.png.

The full suite, unrelated SQL matrices and destructive prior-schema upgrade were not repeated under the MVP testing policy. CI and Netlify Deploy Preview verification remain separate. No hosted migration, account/data/email/settings change or production publication occurred.

The temporary browser wrapper initially omitted deleting its two demo profiles before account cleanup. Its final database teardown still stopped and removed the disposable stack; Docker inventory confirmed no Supabase containers remained, and temporary state/credential files were removed. The temporary wrapper cleanup order was corrected. This did not affect the 59 passing integration scenarios or product code.
