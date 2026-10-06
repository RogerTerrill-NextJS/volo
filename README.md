# Volo

Next.js App Router application with TypeScript. Staging: https://voloapp.netlify.app/.

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
  `codex/volo-15-repository-ci`.
- Keep each branch focused on one ticket and open a pull request into `main`.
- Merge after CI passes; squash commits and delete the merged feature branch.
- Reference the Jira key in the pull request or commit message.
- Commit `package-lock.json` whenever dependencies change.

## Database migrations

There is no database schema yet. When Supabase database work begins, commit SQL
migrations under `supabase/migrations/` in the same pull request as the code
that depends on them. Use timestamped names such as
`YYYYMMDDHHMMSS_describe_change.sql`. Keep migrations reproducible and avoid
editing migrations that have already been applied in shared environments.
Never include credentials or private production records in migrations or seeds.

## Credentials and private data

Keep local credentials in ignored `.env*` files and configure staging credentials
in Netlify's environment settings. Never commit credentials, database exports,
or private user data. Review staged changes before committing.

Only intentionally public values may use `NEXT_PUBLIC_`. Supabase secret and
service-role keys must stay in server code; modules using privileged credentials
must import `server-only`. Never return those values in page props or API responses.
