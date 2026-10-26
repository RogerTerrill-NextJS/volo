# VOLO-217 — Authorized report intake

Base: merged VOLO-216 (`9075926`). Ordinary active members can submit a report referencing a visible licensed pilot, a flight they may currently read, or a message in their retained participant conversation. Reporter identity and creation time are server-owned. The report stores only target kind/UUID and a required reason of 1–2,000 Unicode characters. Administrators have no target-visibility bypass.

Reports are immutable and readable only by their current active reporter or a current active administrator. Direct writes and privileged RPC bypass are closed. Bounded server queries validate the projection and recheck current identity/role before returning it. A report reference does not grant access to its target or copy private message bodies. Founder investigation must respect existing private-message access limits; this ticket does not provide an administrator conversation reader.

The user resolved VOLO-87's open personal-blocking question: MVP handling uses reports and founder-admin actions only. Submission does not disable members, hide posts, block pilots or change requests/messages. VOLO-218 owns the product entry point and founder handling instructions; this ticket supplies intake and bounded read primitives.

An exact report UUID/payload retry confirms the original receipt, including after target visibility changes. Changed payloads or another reporter's identity receive a fixed conflict. Lost or malformed confirmations remain uncertain with no automatic retry. Independent review identified a timing window between a missing receipt lookup and changed flight visibility. A second immutable receipt lookup after target/membership waits closes that window before permission rejection. The three-session overlap regression observes hide and retry waits and verifies one retained report and its original timestamp; it does not force a particular PostgreSQL wait-queue order.

## Verification

- 38 targeted unit/infrastructure checks passed, covering input/result binding, bounded reads, role changes, mutation policy, owned cleanup and upgrade-verifier guards.
- After the review correction, all 77 targeted SQL checks and all five real-session report scenarios passed. They cover native/fetched actual actions, current membership/target authorization, PRIVATE and message privacy, exact/changed/foreign retry identity, ambiguous confirmations, concurrent exact retries, bounded reads and revoked reporter/admin access. The observed-lock report/hide/exact-retry regression also passed. Its first driver assertion incorrectly required the retry to wait specifically behind the hide; it now accepts either valid blocker and retains the receipt/count/state assertions.
- Database types were generated from the owned migrated local stack. Both explicit upgrade-history lists include the report migration. The lock regression reuses the CI upgrade verifier's existing SQL sessions.
- Route generation, TypeScript, focused ESLint and server-only import checks passed. Independent review found the timing window described above and confirmed the second receipt lookup addresses it. Owned fixtures were cleaned up.

The full suite, unrelated SQL matrices and destructive upgrade run were not repeated under the MVP policy. CI and Netlify Deploy Preview verification remain separate and pending. No hosted migration application, accounts/data/email/settings changes or production publishing occurred.

## CI follow-up — member pagination fixture

The first PR run passed the build/unit and database jobs but failed `member_admin_page_uncertain_recovery_paging_and_stale_actor` in the shared Auth job before report intake ran. That scenario created 52 extra members, then fetched the first page to submit a stale-admin action for an original randomly ordered member. If that member landed on page two, the fixture threw `Owned member control missing` before reaching the authorization check.

A deterministic local reproduction selected the known second-page target while retaining the first-page form and failed at that exact fixture lookup. The correction keeps that second-page target, reloads its form with the saved cursor and submits with the same cursor. It still disables the acting administrator immediately before the mutation and checks that the target remains active; no authorization assertion or product behavior was relaxed.

With the correction, all 17 scenarios in the shared member/moderation/report runner passed (5 member, 7 moderation, 5 report), including the deterministic second-page stale-admin case. Focused ESLint and diff checks passed. The failing regression and final verification both used disposable owned local stacks; resources were cleaned up. No production code or hosted state changed in this follow-up. The pushed correction requires a fresh CI result; the original failed run is not treated as passing.
