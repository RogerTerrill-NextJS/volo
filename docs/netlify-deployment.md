# Netlify deployment

Historical VOLO-108 verification, October 6, 2026. Use the [release, rollback and usage checklist](release-workflow.md) for current operations; the dated build/HTTP evidence below does not identify the currently published frontend.

## Repository and build settings

The existing Netlify project `voloapp` is connected to
[RogerTerrill-NextJS/volo](https://github.com/RogerTerrill-NextJS/volo).
Review its [deployment settings](https://app.netlify.com/projects/voloapp/configuration/developer-settings)
when changing the build or repository connection.

| Setting | Verified value |
| --- | --- |
| Base directory | Repository root |
| Package directory | Not set |
| Build command | `npm run build` |
| Publish directory | `.next` |
| Node.js | 24.x |
| Framework | Next.js, automatically detected |
| Production branch | `main`, automatic publishing locked (October 6, 2026) |
| Deploy Previews | Pull requests targeting `main` |
| Branch deploys | Only the production branch |

Netlify automatically installs its supported OpenNext adapter. Leave the adapter
unpinned so Netlify can apply compatibility updates, as recommended in the
[Netlify Next.js guide](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/).
No repository `netlify.toml` or explicit adapter dependency is required by the
current setup. Keep Next.js server output enabled; do not add `output: "export"`
or a single-page-app catch-all rewrite.

## Deployment contexts

- Production: <https://voloapp.netlify.app/>, built from `main`.
- Pre-release review: the Deploy Preview linked from each pull request.
  Preview URLs follow `https://deploy-preview-<PR-number>--voloapp.netlify.app/`.
- VOLO does not use a separate staging environment or staging database,
  per the confirmed [release workflow](release-workflow.md). A PR preview currently
  shares the production Supabase project and is not an isolated staging environment.

Production and Deploy Previews currently have `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Untrusted fork deploys require approval.
Keep actual values in Netlify or ignored local environment files. Environment
context mapping, fork approval semantics, and provisioning/rotation are recorded
in [Environment configuration](environment-configuration.md#netlify-and-ci)
after VOLO-106's hosted audit. Auth redirects remain tracked under VOLO-107.

## Verified hosted deployment

[Production deploy `6ac597cacf56d7000851a06d`](https://app.netlify.com/projects/voloapp/deploys/6ac597cacf56d7000851a06d)
built commit `5ec06e349ba5cc7db29efbbfe939943e02df7f16` from `main`.
The completed build log records:

- Next.js 16.3.8 and Next.js Runtime v5.16.2 (OpenNext).
- Successful `npm run build` and TypeScript checks.
- `/api/health` marked dynamic, served on demand.
- Packaging `___netlify-server-handler/___netlify-server-handler.mjs`
  and deploying one server function.

HTTP checks on October 6 returned 200 for the production homepage, `/dashboard`,
and `/api/health`. The health response was `{"status":"ok"}`.
The [PR #5 preview deployment](https://app.netlify.com/projects/voloapp/deploys/6ac5972ab1753f00081a3452)
also completed successfully, and its
[immutable health URL](https://6ac5972ab1753f00081a3452--voloapp.netlify.app/api/health)
returned 200 with the same JSON.

The [VOLO-108 PR #6 preview](https://deploy-preview-6--voloapp.netlify.app/)
also returned 200 for the homepage, `/dashboard`, and `/api/health`, with the
expected dashboard heading, navigation link, and health JSON.

A [cache-free rebuild](https://app.netlify.com/projects/voloapp/deploys/6ac5993b46b4f934371f63d6)
of commit `05eb1da4b7dc144b18bd5e5905111c5af260f775` completed successfully.
Its log confirms a fresh repository clone, no cached dependencies, no Next.js
cache to restore, runtime v5.16.2, and successful server-handler packaging.
Its [immutable health URL](https://6ac5993b46b4f934371f63d6--voloapp.netlify.app/api/health)
returned 200 with `{"status":"ok"}`. This establishes a clean hosted build;
the documentation commit recording this result follows the tested revision.

## Verify the next deployment

Follow the single [release checklist](release-workflow.md), including all current CI jobs, exact preview/main commit matching, shared-Supabase write boundaries, locked batch publication and post-release evidence. Use [Deploy Preview routing verification](preview-verification.md) and [private cache verification](private-caching.md) for detailed checks. The [VOLO-111 non-publishing rehearsal](volo-111-verification.md) records observed controls and their limits; frontend rollback does not recover database state.
