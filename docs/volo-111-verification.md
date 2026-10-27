# VOLO-111 — Release/rollback checklist and rehearsal

Scope: [VOLO-111](https://outsidethecockpit.atlassian.net/browse/VOLO-111), under VOLO-93, from main `d51c9df` after VOLO-230. The [release workflow](release-workflow.md) is the operational entry point; [Netlify deployment](netlify-deployment.md) retains dated historical build evidence and links to it. Roger owns technical checks and usage review, consistent with the existing founder roles. No production publication or hosted account/email/Auth/database/Storage/settings change was authorized or performed.

## Non-publishing walkthrough — 2026-10-27

Performed through the existing Netlify dashboard and a public immutable health URL, using the existing signed-in dashboard session. No new preview, environment, build or monitoring service was created.

| Step | Observed result |
| --- | --- |
| Identify current production | Deploys showed **Auto Publishing Locked**, published main `36d8226`. The exact [live deploy](https://app.netlify.com/projects/voloapp/deploys/6ad9817c7f17dc1ab5a30895) showed **Published & locked deploy** and “Publishing is locked to this deploy.” |
| Distinguish main builds from publication | Main `d51c9df` had a [completed production-context build](https://app.netlify.com/projects/voloapp/deploys/6ae0f373f7887c15e2956ec9), while the published pointer remained `36d8226`. Completed does not mean live. |
| Locate a historical production artifact | The [October 6 production artifact](https://app.netlify.com/projects/voloapp/deploys/6ac5a76cff4a4f000847161b), previously recorded in the release docs, remained available and showed **Deploy successful**, Production/main `d02e261`, an immutable permalink and an enabled **Publish deploy** control. |
| Inspect the artifact without publishing | Opened its [immutable health URL](https://6ac5a76cff4a4f000847161b--voloapp.netlify.app/api/health). The browser rendered `{"status":"ok"}`. This establishes reachable historical server output, not complete application or backend compatibility. |
| Stop before the operation boundary | Did not click Publish deploy, unlock publishing, trigger/retry a build, edit settings or invoke any restore/delete operation. No publish confirmation or post-publish lock behavior was exercised. |
| Recheck the live pointer | Reloading the current live deploy still showed `6ad9817c7f17dc1ab5a30895`, commit `36d8226`, **Published & locked**. |
| Inspect usage-review navigation | Netlify **Usage & billing → Account usage insights** exposed Credits, Bandwidth, Web Requests and Compute, including serverless/edge usage. Account balances, invoices and private usage values are not copied here. No billing, budget, plan, alert or compute setting changed. |

**Result:** the non-publishing selection/control/health/abort path was rehearsed and the live pointer/lock remained unchanged. This is not a performed rollback, a production smoke pass, a current backend-compatibility sign-off or approval to republish the historical artifact. That artifact predates current workflows; an actual release must choose and verify its own compatible previously published rollback target. Supabase account usage was not inspected; the checklist's Supabase usage/compute steps were checked against official documentation only. Current budgets/headroom still require Roger's private review at operation time.

## Checklist/source review

The revised entry point covers exact batch authorization and SHA, all three current CI jobs plus Netlify preview, shared-Supabase write boundaries, backend/rollback compatibility, retained deploy identity, deliberate publication without unlocking, post-release smoke and separate preview/production records. It names Roger for usage review and pausing optional manual publishes; founder spending choices remain shared. It does not direct a database reset or treat frontend rollback as VOLO-112 recovery.

Removed the old 148-credit balance and its fixed 2–3-release quota. Neither was a current budget. Provider rates and account allowances are checked at operation time; no current balance is committed. The previous instruction to unlock and then relock was replaced with a stop if the intended publication path would require unlocking. Preserving the lock avoids exposing newer queued/completed builds to automatic publication.

Official sources checked on 2026-10-27:

- [Netlify manage deploys](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/): existing-artifact publication, locked deploy behavior, branch-HEAD rebuild distinction and artifact retention.
- [Netlify credit rules](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/) and [usage review](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/monitor-usage-for-credit-based-plans/): preview versus production/rollback charging, daily/team usage and compute/traffic review.
- [Supabase compute usage](https://supabase.com/docs/guides/platform/manage-your-usage/compute): project/organization usage selection and compute outside the spend cap. No pricing-plan or current account-usage assertion is inferred from these docs.

All 15 local Markdown links across the four changed documents and whitespace checks passed. Independent static review found no material issues and confirmed the CI names against the workflow; it did not repeat hosted inspection. Application tests are intentionally not run for this documentation-only change. No production release, hosted writes, database recovery, complete compatibility matrix, current budget sufficiency or actual post-rollback client/session/cache behavior is claimed. Those remain checks of the separately approved operation and VOLO-112/VOLO-92 where applicable.
