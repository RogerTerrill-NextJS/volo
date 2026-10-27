# Volo release and frontend rollback checklist

Feature branch → reviewed PR / CI / Netlify Deploy Preview → merge into `main` → **user-requested batch publication**. Roger owns technical release checks and usage review; founder scope/spending decisions remain shared. There is no staging environment. Previews and production share Supabase, so previews do not isolate writes. Keep PR previews automatic and production auto-publishing locked.

## Release checklist

1. **Define the batch.** Record user authorization, tickets, exact `main` SHA and production URL, <https://voloapp.netlify.app/>. Merging/building is not publication. Run targeted checks for ordinary PRs and the full suite before release.
2. **Check review and CI.** Require successful latest-revision **Typecheck, lint, build and test**, **Real Auth and session integration**, **Rebuild database and test access policies**, and Netlify preview results; resolve review conversations. Check the final batch SHA as well as its PRs. Use `feature/` branches and preserve unfinished work.
3. **Verify the reviewed preview.** Record its commit, immutable deploy URL and changed-flow results. Use the existing [preview checks](preview-verification.md) and [cache checks](private-caching.md). Check home/login, anonymous protected-route denial and health. Test writes only locally/disposably unless separately approved. Reconcile preview/main SHA differences.
4. **Check backend and rollback compatibility.** Check separate approvals/evidence for migrations, Auth/configuration and feature gates; Netlify does not apply them. See [Supabase setup](supabase-setup.md), [environment configuration](environment-configuration.md) and each included feature's runbook. Identify a retained, previously published, known-good frontend and check it against the backend/configuration that will exist after release. Resolve compatibility before publishing; frontend rollback cannot recover data. VOLO-112 owns database recovery.
5. **Record the current deployment and usage.** In [Netlify Deploys](https://app.netlify.com/projects/voloapp/deploys), confirm **Auto Publishing Locked** and save the current published deploy ID/SHA, selected batch deploy ID/SHA, and rollback deploy ID/permalink. Use the usage review below. Confirm the rollback artifact is still retained; a historical URL alone does not guarantee availability.
6. **Publish the exact completed batch only within its approval.** Open the completed production-context build matching the selected `main` SHA, check its immutable URL, and use **Publish deploy**. Keep auto-publishing locked. Do not use **Unlock to start auto publishing**, **Trigger deploy** or **Retry deploy** as a substitute for publishing the chosen artifact. If the flow would require unlocking, stop and resolve the method before proceeding. Confirm the selected deploy is now **Published & locked** and that the production pointer matches its SHA.
7. **Verify production and record the outcome.** Repeat the read-only smoke at the production URL: home/login, anonymous `/dashboard` denial, health JSON, direct navigation/refresh and the batch's affected flows. Use approved sessions for permitted reads; hosted writes still require bounded approval. Check a fresh browser and an existing browser/PWA session where relevant. Health alone proves availability. On failure, pause publication and use the approved rollback procedure. Record production separately from preview evidence; recheck the lock.

## Frontend rollback

This is an operational procedure, **not authorization to publish**. Execute only within a separately approved release/rollback operation; a rehearsal stops before publication.

1. Record the incident, failing published deploy/SHA, observed failure and the intended prior **published production** deploy/SHA. Do not select the previous main build merely because it completed.
2. Open that exact retained deploy in Netlify. Check successful build, commit, production context, immutable permalink and prior release evidence. Verify compatibility with current database/RPCs, Auth, configuration and scheduled work. Old bundled public values may differ; publishing an old artifact does not restore hosted settings. If incompatible, stop and use a reviewed corrective release/database-recovery plan; never reset production or reverse migrations ad hoc.
3. Under the operation's approval, use **Publish deploy** on that existing artifact. Do not trigger a rebuild from today's branch HEAD. Keep auto-publishing locked; stop if the UI would require unlocking it.
4. Confirm the production pointer is the selected rollback deploy and **Published & locked**. Repeat the release smoke and changed-flow checks in fresh and existing sessions. Record remaining issues; restoring the pointer is not proof that the application works.
5. Open a corrective/revert PR so `main` reflects the intended next release. Keep further publication paused until reviewed. Database/Auth/Storage recovery remains separate under VOLO-112, not part of frontend rollback.

## Usage review and pause decision

Roger checks **before each requested batch, after publication, and during weekly beta operations**. Keep balances, invoice/payment details and raw usage evidence in restricted founder notes, not this public repository.

- **Netlify:** open [Usage & billing](https://app.netlify.com/teams/rogerterrill/billing/general) and [Account usage insights](https://app.netlify.com/teams/rogerterrill/billing/usage). Check the actual billing period/reset, current allowance/balance, daily credit trend, production-deploy consumption, bandwidth/web requests and serverless/edge compute. These are team totals; inspect VOLO's contribution where shown rather than assigning every charge to it.
- **Supabase:** select the existing VOLO project on the organization's Usage page. Review current plan/period/limits, configured compute and CPU/memory, database/Storage size, egress, Auth and Realtime usage as applicable. Compute and usage allowances differ; do not assume a spend cap covers compute. No second hosted environment is needed.
- **Pause optional manual publishes** when allowance/headroom is unclear, an alert or unexplained spike appears, or the proposed batch exceeds the founders' agreed budget. Roger records the cause/owner/next check and avoids redundant rebuilds/publishes. Keep automatic production publication locked and PR previews automatic. Budget/plan/compute-size/alert-setting changes require their own approval; do not pause the production database or disable previews as a cost-control shortcut.
- Check current plan terms rather than reusing an old balance or fixed release quota. On credit-based Netlify plans, previews have no deployment charge, but traffic/compute can still consume credits; rollback to an existing previous production deploy has no deployment credit charge. Verify current [credit rules](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/), [usage navigation](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/monitor-usage-for-credit-based-plans/) and [Supabase compute rules](https://supabase.com/docs/guides/platform/manage-your-usage/compute) at review time. No new monitor, paid service or automatic recharge is introduced.

## Release record

Use existing restricted operational notes; publish only sanitized technical evidence in a PR/ticket.

```text
Operation: release / rollback / non-publishing rehearsal
Authorization and operator; date/time and timezone:
Tickets and exact selected SHA; CI/review links:
Preview immutable URL/SHA and results:
Before: published deploy ID/SHA and lock state:
Candidate/rollback deploy ID/SHA/permalink; compatibility evidence:
Usage review period, private evidence reference and proceed/pause decision:
Publication: performed / not performed; after pointer and lock:
Production smoke: performed / not performed, checks/results/remaining risks:
Next action and owner; corrective PR if needed:
```

[VOLO-111 rehearsal evidence](volo-111-verification.md) records the bounded non-publishing walkthrough. Netlify documents the [existing-artifact rollback and lock controls](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/). Historical build setup remains in [Netlify deployment](netlify-deployment.md); it is not a live-release record.
