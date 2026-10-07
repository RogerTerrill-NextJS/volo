# Environment configuration

VOLO-104 defines the app's environment contract. Netlify Deploy Previews provide
pre-release review; production releases are manual batches from `main`.
Production auto-publishing stays locked. There is no staging environment.

## Variable contract

| Variable | Purpose | Required where | Exposure |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API origin; selects the app's project | Local dev/build/start, Netlify Production and Deploy Preview builds | Browser-public, frozen at build time |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Matching project's `sb_publishable_` API key | Same as URL | Browser-public, frozen at build time |
| `SUPABASE_PRODUCTION_PROJECT_REF` | Hosted project identifier for operator reference | Optional; not read by the app | Identifier, not a credential; do not prefix with `NEXT_PUBLIC_` |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI management access | Only CLI operations that require it | Secret; local shell or protected CI only |
| `SUPABASE_DB_PASSWORD` | Hosted database credential for CLI operations | Only CLI operations that require it | Secret; local shell or protected CI only |

The app needs no privileged Supabase key. Do not add CLI credentials or secret /
service-role keys to Netlify or any `NEXT_PUBLIC_` variable. Client boundaries
and privileged-client handling are tracked separately in VOLO-105.

## Local setup

1. Use Node.js 24 and run `npm ci`.
2. Run `cp .env.example .env.local` in the repository root. Keep real values in
   this ignored file; commit only the placeholder example.
3. For isolated database work, start the local Supabase stack using
   [Supabase setup](supabase-setup.md). Set the public URL and publishable key
   from that local instance. Leave CLI secrets blank for ordinary app work.
   If using the shared hosted project instead, obtain its matching publishable
   key from the Supabase dashboard and avoid mutation tests against shared data.
4. Run `npm run dev`, then open `/`, `/dashboard`, and `/api/health` locally.
   The health route checks app availability, not database connectivity.
5. Restart dev after changing values. Run the standard typecheck, lint, build,
   and test commands before opening a PR.

Next.js loads `.env` files before evaluating `next.config.ts`. Configuration
validation runs there, so dev, build, start, and type generation report missing
or invalid required settings early. Errors name the variables and setup guide;
they never echo values. The URL must be an HTTPS origin with no credentials,
path, query, or fragment. Local loopback HTTP is allowed for Supabase CLI.
This contract accepts the modern `sb_publishable_` key format, not legacy JWT
keys. Syntax validation does not prove that a key exists or matches its project;
authentication and database connectivity are checked by later tickets.

Existing shell variables take precedence over `.env.local`. Next.js does not
load `.env.local` under `NODE_ENV=test`; don't set `NODE_ENV` to `preview`.
Never run commands that dump the entire environment into logs or Jira.

## Netlify and CI

Production and trusted Deploy Previews currently share the hosted Supabase
project `macrktxywcqauxqkbnqb`. A preview URL provides no database isolation.
Both contexts need the matching URL and publishable key at build time. Changing
public values requires a rebuild of the affected context. Do not promote a
build made for a different Supabase project without rebuilding it.

VOLO-106 verifies the hosted context settings and untrusted-fork policy.
VOLO-107 supplies the stable callback allowlist; this ticket does not configure
callbacks or implement authentication.

GitHub app CI uses `https://example.supabase.co` and
`sb_publishable_ci_fixture`, deliberately nonfunctional configuration fixtures.
They permit offline builds and public-page smoke tests without real credentials.
Future authentication tests need their own local/disposable backend setup;
these fixtures cannot validate database or login behavior.

## Local verification

On October 6, 2026, Next.js loaded an ignored `.env.local` with loopback URL and
a synthetic publishable-format key. Missing configuration produced variable
names and setup guidance without supplied values. Type generation, TypeScript,
and ESLint passed. All 11 environment and route tests passed against both
webpack development and production servers; the webpack production build passed.
The temporary fixture file was removed afterward. No Supabase request or data
mutation was needed.

Default Turbopack development on this Codex host failed while spawning a pooled
Node worker for CSS compilation, returning HTTP 500 for four page-route checks.
Adding the bundled Node to PATH did not resolve it. Local verification used the
documented `next dev --webpack` and `next build --webpack` flags; committed
scripts keep the default bundler. Hosted CI and the PR preview must verify that
default path before merge.

Keep `.env*` files ignored except `.env.example`. Rotate actual values in the
owning service and update ignored local files and affected Netlify contexts;
record variable names and verification results, never the values. Consult
[Next.js environment variables](https://nextjs.org/docs/app/guides/environment-variables)
and [Supabase API key types](https://supabase.com/docs/guides/getting-started/api-keys).
