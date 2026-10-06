# Volo release workflow

Feature branch → pull request → CI and Netlify Deploy Preview → squash merge into main → production.

## Environments

- Local: http://localhost:3000.
- Preview: the unique Netlify Deploy Preview linked from each pull request. Check changes here before release.
- Production: https://voloapp.netlify.app/, deployed by Netlify from main. Older documentation calls this staging; Netlify currently publishes it as production.

A permanent staging branch is not needed for this early-stage flow.

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

1. Wait for `Typecheck, lint, build and test` and the Netlify Deploy Preview check to succeed on the latest revision.
2. Open the preview link. Check the homepage, `/dashboard`, `/api/health`, and changed user flows. Local smoke tests do not replace checking the hosted preview.
3. Resolve review conversations. If main has moved, update the feature branch and rerun checks.
4. Squash merge. Netlify builds main and publishes production automatically. Verify the production deploy and changed flows.

Main protection requires a pull request, passing app CI and Netlify preview checks, an up-to-date branch, and resolved conversations. Protection also applies to administrators. Required approving reviews are disabled so a solo developer can merge their own pull requests. Force pushes and deletion of main are disabled.

## Database and credentials

Before connecting previews to Supabase, configure a separate staging project. Give the Netlify Deploy Previews context staging values and the Production context production values. Do not give previews production database credentials. Keep secret keys server-side and out of source control.

Test database migrations locally or on disposable staging data before production. App deployment does not apply database migrations automatically. Add the database CI check to main protection when the pending database workflow is merged and its check has run successfully.

## Roll back

In Netlify Deploys, publish the previous known-good production deployment, then open a corrective or revert pull request so main matches the intended release. Check environment-variable changes too. App rollback does not undo database migrations; handle database recovery separately and never reset production.
