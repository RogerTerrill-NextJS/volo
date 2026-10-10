# VOLO-125 invitation Auth verification

The existing VOLO-119 owned local Auth/mail/app harness now includes:

| Scenario | New evidence |
| --- | --- |
| `invitation_setup_binding_denials` | Real verified sessions cannot borrow setup across subjects or sessions. Revoked, superseded and renewed grants, plus changed dot/plus recipient emails, deny before password or membership writes. |
| `invitation_age_and_independent_expiry` | Real provider verification rejects an expired token. A year-2000 invitation remains eligible through renewal. Separate 30-minute setup authority expires while Auth remains verified; renewed verification completes the same member. |
| `invitation_completion_concurrency` | Independent native requests make one provider password update and one member redemption. Fresh protected requests admit the same subject; duplicates skip another password update. |

Existing scenarios supply signup/provider denial, actual provider email normalization,
scanner/prefetch safety, replay, existing/disabled-account protection, resend fencing,
ambiguous provider/partial failures, origin checks, cookie persistence and private
responses. Existing database tests remain the atomicity/constraint evidence.

Local validation passed: 30 real Auth scenarios, 46 core/smoke tests, lint and
typecheck. The Auth harness compiles its production Next fixture. Shorter owned
project IDs avoid the CLI's 40-character truncation; automatic cleanup left no
running containers.

Run `npm run test:auth:integration` with Docker running. The sanitized result is
written to `.superpowers/sdd/2026-10-07-volo-119-auth-integration/summary.json`.
Expiry/age fixtures backdate owned local timestamps rather than waiting 30 minutes.

One existing parallel-identity RSC check failed once, then passed unchanged on
the diagnostic rerun. Its cause remains unconfirmed; the strict assertion is
retained. CI must still pass on the PR. Hosted acceptance, browser usability,
Netlify CDN behavior and production release verification remain separate work.
No hosted writes, migrations or product behavior changes are included.
