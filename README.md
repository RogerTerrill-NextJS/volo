# Volo

Next.js App Router application with TypeScript. Production: https://voloapp.netlify.app/.
Pull requests receive Netlify Deploy Previews. A separate staging environment is deferred.
See [Netlify deployment](docs/netlify-deployment.md) for verified build settings,
runtime evidence, and deployment checks.

## Development

Use Node.js 24 and npm. Install the committed dependency versions:

```sh
npm ci
npm run dev
```

Open http://localhost:3000. The dashboard is at `/dashboard`; `GET /api/health`
returns `{ "status": "ok" }` and checks application availability only.

## Validation and CI

```sh
npm run typecheck
npm run lint
npm run build
npm test
```

The smoke tests start a local production server and check the homepage link,
direct dashboard access, and health response. Build before running tests.
The build downloads the existing Geist fonts from Google Fonts and needs
network access.

GitHub Actions runs these checks on pull requests, pushes to `main`, and manual
runs. CI uses `npm ci` with `package-lock.json` and requires no application
credentials. After pushing the workflow, verify its first run in GitHub Actions.

## Version control

The repository is intentionally public for the current Netlify deployment setup.
This is an exception to VOLO-15's original private-repository criterion.
`private: true` in `package.json` prevents npm publication; it does not set
GitHub visibility.

- Keep `main` deployable.
- Start a short feature branch from the latest `main`, for example
  `feature/volo-103-setup-docs`.
- Keep each branch focused on one ticket and open a pull request into `main`.
- Merge after CI passes; squash commits and delete the merged feature branch.
- Reference the Jira key in the pull request or commit message.
- Commit `package-lock.json` whenever dependencies change.

## Database migrations

The Supabase foundation includes server-owned memberships, RLS, fictional seeds,
and database permission tests. See [Supabase setup](docs/supabase-setup.md) for the
environment inventory, local/disposable rebuild verification, production migrations,
and initial-admin bootstrap.
Local database work requires a running Docker-compatible runtime:

```sh
npm run db:start
npm run db:reset
npm run db:test
npm run db:types
npm run db:types:check
```

Commit SQL migrations under `supabase/migrations/` in the same pull request as the code
that depends on them. Commit generated `lib/supabase/database.types.ts` after successful
database introspection. Use timestamped names such as
`YYYYMMDDHHMMSS_describe_change.sql`. Keep migrations reproducible and avoid
editing migrations that have already been applied in shared environments.
Never include credentials or private production records in migrations or seeds.

## Credentials and private data

Keep local credentials in ignored `.env*` files. Netlify Production and Deploy Previews
currently use the same hosted Supabase URL and public publishable key; previews do not
isolate database data. Use local/disposable data for write tests. Never commit credentials, database exports,
or private user data. Review staged changes before committing.

Only intentionally public values may use `NEXT_PUBLIC_`. Supabase secret and
service-role keys must stay in server code; modules using privileged credentials
must import `server-only`. Never return those values in page props or API responses.
