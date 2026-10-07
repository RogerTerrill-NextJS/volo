# Volo

Next.js App Router application with TypeScript. Production: https://voloapp.netlify.app/.
Pull requests receive Netlify Deploy Previews. VOLO does not use a separate staging environment.
See [Netlify deployment](docs/netlify-deployment.md) for verified build settings,
runtime evidence, and deployment checks.

## Development

Use Node.js 24 and npm. Install the committed dependency versions:

```sh
npm ci
cp .env.example .env.local
# Fill the two NEXT_PUBLIC_SUPABASE_* fields using the setup guide below.
npm run dev
```

Open http://localhost:3000. The dashboard is at `/dashboard`; `GET /api/health`
returns `{ "status": "ok" }` and checks application availability only.
See [environment configuration](docs/environment-configuration.md) for required
values, local/disposable setup, deployment contexts, and safe error handling.

## Validation and CI

```sh
npm run typecheck
npm run lint
npm run build
npm test
npm run test:clients
npm run test:proxy
npm run test:access
npm run test:boundaries
```

The smoke tests start a local production server and check the homepage link,
direct dashboard access, repeat document requests, health HTTP methods, and
missing nested routes. Build before running local tests. To run the same checks
against a Netlify Deploy Preview without starting a local server:

```sh
SMOKE_BASE_URL=https://deploy-preview-<PR-number>--voloapp.netlify.app npm test
```

These HTTP checks verify server-delivered HTML and Route Handler behavior;
also check link navigation and browser refresh in the preview browser.
The boundary check builds a disposable fixture with synthetic secrets, verifies
that client imports of privileged configuration fail, and scans browser assets
and responses for leaks. It never connects to Supabase. The client check uses
real SDK clients in a disposable Next.js app with fictional sessions and a
loopback Auth stub to verify request isolation, cookie chunks and write failures.
See [client usage](docs/environment-configuration.md#supabase-client-factories).
The Proxy check verifies session refresh, cookie forwarding, scoped cleanup,
cache protections and bounded Auth failures using fictional loopback sessions.
The access check verifies identity, current membership and explicit role guards,
including revocation, concurrent requests and bounded service failures. It uses
fictional loopback Auth/PostgREST with the real SDK and Next request contexts;
database CI independently verifies RLS. The dashboard remains public until VOLO-116.
The build downloads the existing Geist fonts from Google Fonts and needs
network access.

GitHub Actions runs these checks on pull requests, pushes to `main`, and manual
runs. CI uses `npm ci` with `package-lock.json` and dummy public configuration;
its app checks require no real application credentials or hosted database access.
After pushing the workflow, verify its first run in GitHub Actions.

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
