# VOLO-207 — Authorized conversation list

Adds `/messages` and AppShell navigation using the existing conversations and messages. Ordinary session RLS controls conversation and preview reads. Flight context is fetched separately through current flight visibility; retained conversation history never grants private flight access. Optional counterpart profiles have a neutral fallback. Latest message bodies are normalized, limited to 160 Unicode code points plus an ellipsis, and rendered as escaped React text.

Lists 20 conversations per page, newest conversation creation first, with timestamp/UUID keyset navigation. This ordering is explicit and does not move conversations when messages arrive. Strict cursor/provider validation, a participant-binding re-read after optional profile work, final current viewer verification, individual read deadlines and no-store reads fail safely. Includes loading, empty, older-page empty, invalid-page and sanitized retry states. Entries link to their existing flight connection; the message screen/composer and realtime UI remain their separate tickets.

## Verification

- Five targeted unit tests passed: active viewer requirements and mid-read revocation/account changes; foreign/malformed bindings; stable timestamp ties and cursors; bounded Unicode previews; required read errors and optional profile failures.
- All 45 targeted real-Auth flight-interest/connection/messaging scenarios passed. The added rendered-list case verifies both pilots, unrelated member/admin/disabled/unadmitted denial, private route removal with closed preview retention, viewer disabling, empty and invalid-page states, escaped script text, and private no-store response headers.
- Route generation, TypeScript, focused ESLint, Supabase client/server boundaries and diff whitespace checks passed. The boundary check initially reached its local listener sandbox restriction, then passed with local server permission.
- Desktop and 320px local Chrome inspection verified actual loading-to-list rendering, literal script text, long-word wrapping, 320px document width, 44px link targets and keyboard activation reaching the correct accepted connection. Independent code review found no actionable issues.

Only owned fictional local accounts/data were used. No database migration is required. The full suite and hosted Deploy Preview verification were not run. No hosted data/account/email/settings changes or production publication occurred; preview review and any later requested production release remain separate.
