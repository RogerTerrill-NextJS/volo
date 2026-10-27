# VOLO-228 — Feedback process trial and verification

Base: merged VOLO-227, `6113813`. Scope: [VOLO-228](https://outsidethecockpit.atlassian.net/browse/VOLO-228), parent VOLO-95. On 2026-10-27 Roger chose **private conversation with the inviting founder**. Founder ownership follows VOLO-3: Enrique coordinates engagement/collection, Roger handles technical triage, and product/launch decisions stay shared. The [operating guide](beta-feedback.md) is linked from README and the existing report-handling guide.

## Fictional tabletop trial — 2026-10-27

This is a walkthrough of the written templates, not real tester intake or a test of a messaging provider. `DEMO-F01`–`DEMO-F07` and `SIM-BUG-A` below are fictional exercise references, not Jira keys, real bug claims or real records. No person was contacted, no Jira issue was created and no hosted app writes were performed. Actual feedback must stay outside this public repository.

### Worked bug: DEMO-F01

Fictional tester reply: “On an owned local fixture at about 09:00 America/Los_Angeles, Chrome on macOS, I opened `/directory` and searched for a fictional airport. The result heading overlaps the search field at a narrow width. I expected to read both. I can work around it by widening the window.” No real pilot, screenshot, private URL or sign-in data is included.

Applying the restricted intake template:

```text
Feedback reference: DEMO-F01 (fictional)
Received: 2026-10-27 09:00 America/Los_Angeles (fictional)
Owner: inviting founder; Roger for technical triage after acknowledged handoff
Private source: simulated existing founder conversation; no actual link
Kind: bug
Summary: directory heading overlaps the search field at a narrow width
Context: owned local fixture; Chrome/macOS; /directory; width not yet supplied
Steps / expected / actual: open directory and search; read both controls;
  reported overlap; reproduction remains unconfirmed
Impact: degraded search readability; wider window is a reported safe workaround
Disposition: needs context
Jira key or restricted routing reference: none; simulated duplicate search pending
Next action: receiving founder asks for viewport width and browser version;
  Roger confirms handoff and reproduces with fictional fixtures
Outcome: open; no fix, preview verification or production claim
```

After the exercise supplies a fictional 320px width and browser version, the simulated duplicate search checks “directory heading overlap” and “directory mobile search”. Assume the exercise search returns no match. A sanitized **draft**, ready for Roger's actual Jira triage, is:

```text
Summary: Directory — heading overlaps search field at 320px
Source: beta feedback; DEMO-F01 (fictional exercise only)
Status of evidence: reported, not yet reproduced
Environment: owned local fixture; revision unknown
Device/browser: Chrome on macOS; fictional exercise version supplied privately
Observed: 2026-10-27 about 09:00 America/Los_Angeles (fictional)
Page: /directory
Steps to reproduce:
1. With fictional directory fixtures, set viewport width to 320px.
2. Open /directory and search for a fictional airport.
Expected: heading and search field remain readable and operable.
Actual: tester reports overlapping controls; not independently reproduced.
Impact and safe workaround: degraded readability; widen viewport if available.
Duplicate search: simulated “directory heading overlap”, “directory mobile search”;
  no matching exercise item; no live Jira search or issue creation claimed.
Acceptance: readable, operable heading/search at 320px without broader private reads.
Verification: reproduce and verify in owned fixtures; record actual revision.
Release/follow-up: no PR, preview verification, release or live-fix claim exists.
```

The exercise assigns the placeholder `SIM-BUG-A` to this draft solely to trial duplicate handling below. An actual issue's real Jira key would be recorded only after it is created. Missing context and an unreproduced symptom are explicitly visible rather than manufactured into confirmed evidence.

### Routing and follow-up cases

| Case | Fictional input | Applied outcome and next action |
| --- | --- | --- |
| DEMO-F02 — duplicate | Another tester describes the same directory overlap | Roger's simulated search finds `SIM-BUG-A`. Record duplicate in the private ledger and retain this tester's source/follow-up reference. Add useful sanitized reproduction differences to the original issue when appropriate; no second bug is created. |
| DEMO-F03 — suggestion | “Let me save a favourite airport” | Record the goal and impact as a product suggestion. Enrique collects context; both founders decide scope. No automatic backlog commitment or delivery promise. |
| DEMO-F04 — missing context/help | “I cannot get in” | Keep `needs context`; privately ask which screen, safe error wording, environment and approximate time. Roger assesses possible account-access impact. Never ask for a password, reset link or repeated writes. A help answer need not become a bug. |
| DEMO-F05 — conduct report | Concern about a fictional message, with a report receipt | Route to the existing founder-report procedure. Keep receipt/context restricted. The reference neither copies the message nor authorizes a private-conversation lookup. If the reporter cannot use the app, use the existing private clarification path. |
| DEMO-F06 — deletion | “Delete my account” | Route to the existing verified-request/admin procedure. The support reply is neither verified ownership nor authority to execute deletion. No account or Storage operation, new deadline or completion claim is triggered. Review external support copies separately. |
| DEMO-F07 — security | “I think I can see another pilot's private data” | Route privately to Roger for prompt technical assessment; keep identifying/exploit details out of ordinary Jira and repository documents. Do not solicit the other pilot's content or ask the tester to probe further. No automatic moderation or public disclosure. |

Closure trial: an imaginary PR for `SIM-BUG-A` is merged. The ledger remains open with “awaiting release/verification”; neither the receiving founder nor Roger calls it fixed in production. Only actual preview/owned-fixture evidence verifies the implementation; a separately requested production release and production verification establish live availability. For duplicates, no-change or help outcomes, record the reason and private follow-up status instead of inventing a release.

Handoff trial: if the collecting founder records Roger as triage owner without his acknowledgement, the collecting founder still owns follow-up. A missed handoff therefore remains visible in the next-action field.

## Checks and limits

Documentation review covers tester reachability through an already existing conversation, existing owner responsibilities, minimal diagnostic context, duplicate references, data minimization, report/deletion/security routing and distinct preview/production verification. Local Markdown links and `git diff --check` are checked before commit. No application code, schema, test harness, dependency or hosted setting changes are needed; application tests are not run for this documentation-only change.

The tabletop trial does not establish real message delivery, founder response times, real Jira issue creation, bug reproduction, hosted retention capability or production availability. Before the beta cohort starts, the inviting founder must share the tester message manually and confirm a reply path. No messages are sent by this PR, and no Netlify production release is requested or performed. The automatic Deploy Preview and CI results are separate checks of the branch, not proof of a live feedback service.

Final local checks: **14 local Markdown links across the five changed documents passed**, and `git diff --check` passed. Independent whole-change review found **no material issues**; its limits were live messaging/Jira operation, restricted-tool access, hosted retention and deployment verification. Application tests were intentionally not run for documentation-only work.
