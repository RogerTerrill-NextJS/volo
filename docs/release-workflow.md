# Volo release workflow

Feature branch → pull request → CI and Netlify Deploy Preview → squash merge into main → manual production release of a batch.

## Environments

- Local: http://localhost:3000.
- Preview: the unique Netlify Deploy Preview linked from each pull request. Check changes here before release.
- Production: https://voloapp.netlify.app/, deployed by Netlify from main.

VOLO uses Deploy Previews for pre-release review; there is no permanent staging
branch or separate staging Supabase project.
Production and Deploy Previews currently share the hosted Supabase project;
a frontend preview provides no database isolation.

## Make a change

Start from an up-to-date main with a clean working tree. Preserve unfinished work on a feature branch before updating main; do not reset or discard it.

```sh
git switch main
git pull --ff-only origin main
git switch -c feature/describe-your-change
```

Use Node.js 24 and run the existing checks:

```sh
npm ci
npm run typecheck
npm run lint
npm run build
npm test
```

Review the diff, stage only intended files, commit, and push the feature branch. Open a pull request into main and reference the Jira key where applicable.

## Verify and release

1. Wait for `Typecheck, lint, build and test`, `Rebuild database and test access policies`, and the Netlify Deploy Preview check to succeed on the latest revision. The database job includes the committed type drift check.
2. Open the preview link. Check the homepage, `/dashboard`, `/api/health`, and changed user flows. Use local/disposable data for mutation tests; review and bound any action that would write to the shared production backend. Local smoke tests do not replace checking the hosted preview.
3. Resolve review conversations. If main has moved, update the feature branch and rerun checks.
4. Squash merge. Netlify builds main, but automatic production publishing stays locked. Record the merge and preview results separately from production release evidence.

## Publish a batch

Automatic production publishing was locked on October 6, 2026, preserving
production commit `d02e261` (deploy `6ac5a76cff4a4f000847161b`). PR Deploy Previews
remain automatic. Group reviewed tickets into milestone releases instead of
publishing after every merge. Publish only when the user requests a release.

1. Check the selected `main` commit has passing CI and covers the intended batch.
2. In [Netlify Deploys](https://app.netlify.com/projects/voloapp/deploys), open its
   completed build. Check the commit and immutable deploy URL, then verify the
   combined changed flows before publishing.
3. Manually publish that deploy. Keep automatic publishing locked afterward;
   if the publish flow requires unlocking, re-lock the newly published deploy
   immediately and confirm **Auto Publishing Locked** in the Deploys list.
4. Verify the production URL and changed flows. Record the published commit,
   deploy ID, included tickets, and verification results.

Netlify charges 15 credits per published production deploy. Under a deploy lock,
unpublished builds do not incur that production charge. Deploy Preview deployments
cost zero deployment credits, although traffic and server compute still consume
credits. With 148 credits remaining at this policy change, aim for 2–3 production
releases before the next billing reset, allowing room for traffic and compute.
Check the current balance and reset date before choosing a release budget.
See [Netlify credit rules](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/)
and [publishing controls](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/).

Main protection requires a pull request, passing app CI and Netlify preview checks, an up-to-date branch, and resolved conversations. Protection also applies to administrators. Required approving reviews are disabled so a solo developer can merge their own pull requests. Force pushes and deletion of main are disabled.

## Database and credentials

Netlify Production and Deploy Previews have `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for the same production project
`macrktxywcqauxqkbnqb`. Rebuild affected contexts after changing these build-time values.
No secret/service-role key, database password, or Supabase access token was added to
Netlify. Keep privileged keys server-side and out of source control and browser bundles.
Retain approval for untrusted fork deploys. A public publishable key does not make
preview access read-only; database grants and RLS enforce access.

Test migrations with local/disposable rebuilds before production. CI rebuilds with
and without fictional seeds, runs permission tests after each, and checks generated
types against the migrated database. App deployment does not apply migrations or
hosted Auth settings automatically. Follow [Supabase setup](supabase-setup.md) for
production inspection, dry-run, and migration steps; never seed or reset production.
The database workflow has merged and passed. Requiring its check in main branch
protection is a separate repository setting; this documentation does not establish
that it has been configured.

## Roll back

In Netlify Deploys, publish the previous known-good production deployment, then open a corrective or revert pull request so main matches the intended release. Check environment-variable changes too. App rollback does not undo database migrations; handle database recovery separately and never reset production.
