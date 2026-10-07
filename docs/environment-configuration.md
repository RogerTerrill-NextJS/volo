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

The current app needs no privileged Supabase key. Do not provision one in
Netlify for this ticket. CLI credentials stay in operator shells or protected
CI, and privileged credentials must never use a `NEXT_PUBLIC_` name.

## Browser and server boundaries

`lib/supabase/public-config.mjs` exports `getSupabasePublicConfig()`, which returns
only `{ url, publishableKey }`. Use this for browser clients and ordinary
user-scoped server clients. Literal `process.env.NEXT_PUBLIC_...` reads preserve
Next.js build-time inlining. The helper validates the values before returning
them; it never spreads `process.env` or returns operator credentials.
Startup rejects additional `NEXT_PUBLIC_SUPABASE_*` variables so a secret key,
service-role key, management token, or database password cannot be exposed
through an extra Supabase public variable by mistake.

`lib/supabase/privileged-config.mjs` exports `getSupabasePrivilegedConfig()` and
imports `server-only`. Next.js rejects direct or transitive imports of that
module into Client Components. It returns `{ url, secretKey }` only when an
explicit server operation calls it with a valid-format `SUPABASE_SECRET_KEY`.
Missing/invalid values produce an error naming the variable without its value.
The getter is lazy, so normal builds and pages do not require this optional key.

No Supabase SDK clients are introduced here. When adding user authentication,
use request-scoped browser/server clients with the publishable configuration and
the user's session (VOLO-24). Never use privileged configuration for ordinary
signed-in user queries: privileged keys bypass RLS. Any future privileged-client
factory must itself import `server-only`, must disable browser session behavior,
and must enforce the operation's authorization before use. See
[Supabase key types](https://supabase.com/docs/guides/getting-started/api-keys).

`SUPABASE_SECRET_KEY` is optional server-runtime configuration for a future
explicitly authorized administrative job, not a new deployment requirement.
Never pass its getter result to Client Components, return it from an API or
Server Action, render it, or log it. `server-only` prevents client imports; it
does not stop server code from deliberately serializing a secret into a response.

Run `npm run test:boundaries` to build a disposable Next.js fixture with the
actual configuration modules. It first proves that a client import of privileged
configuration fails compilation, then builds a valid browser/server split with
synthetic secret, CLI-token, and database-password markers. It checks all emitted
browser assets (including any source maps), HTML, RSC, API JSON, and response
headers for those markers. A server-side check proves the privileged getter was
actually exercised; emitted browser JavaScript must contain both public values.
The fixture loads no checkout `.env` files, contacts no Supabase backend, and is
removed afterward. CI runs this check separately from ordinary unit/smoke tests.

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

VOLO-106 verified the following existing settings on October 6, 2026 in
[Netlify environment variables](https://app.netlify.com/projects/voloapp/configuration/env).
Both contextual URL values matched the hosted project above, and both
publishable-key values matched each other and used the modern key format.
Values were compared without copying them into the repository or Jira.

| Variable | Production | Deploy Previews | Other Netlify contexts | Scope |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Shared hosted project URL | Same as Production | Empty | All scopes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Matching hosted publishable key | Same as Production | Empty | All scopes |
| `SUPABASE_SECRET_KEY`, legacy service-role keys, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` | Not provisioned | Not provisioned | Not provisioned | None |

"Other Netlify contexts" means Branch deploys, Preview Server & Agent Runners,
and Local development (Netlify CLI). There are no branch-specific overrides in
the variable list. Local app development uses the ignored `.env.local` described
above. All scopes is the current plan's setting for the two browser-public
variables; it is not permission to put server credentials in those variables.

The [deploy controls](https://app.netlify.com/projects/voloapp/configuration/developer-settings)
use `main` for Production, enable Deploy Previews for PRs targeting `main`, and
deploy only the production branch outside PR previews. Production publishing
remains locked under the [release workflow](release-workflow.md).

### Untrusted forks

The verified Sensitive variable policy is **Require approval**. Netlify holds
an unrecognized author's fork deploy before its build starts. This is an approval
gate, not permanent secret filtering: approving a request allows its build to
run with the preview context. Currently that context contains only the two
browser-public variables, so an approved fork receives no server credentials.
Review the fork's code, build scripts, and dependencies before approving it;
reject requests that should remain untrusted.

Do not add server secrets to the shared Deploy Preview context. Before any
future administrative runtime needs a secret, separately review its production
scope and fork access, including any team-level inherited variables. If secrets
ever become necessary for trusted previews, introduce a policy that demonstrably
withholds them from untrusted builds before provisioning them. Do not select
"Deploy without restrictions". See
[Netlify's sensitive variable policy](https://docs.netlify.com/build/environment-variables/get-started/#sensitive-variable-policy).
This verification inspected the configured gate and variable inventory; it did
not create or approve a test fork or exercise a real credential.

### Provisioning and rotation

1. An authorized operator obtains the hosted project's URL and matching modern
   publishable key from Supabase. Keep actual values in the service dashboards
   and ignored local files, never PR descriptions, screenshots, logs, or Jira.
2. In Netlify Project configuration > Environment variables, add each public
   variable individually (or use Options > Edit). Set contextual values explicitly
   for **Production** and **Deploy Previews** only, using the same pair. Leave
   other contexts empty and preserve **Require approval**. Avoid bulk CLI imports
   that default to all contexts. Check for branch overrides before saving.
3. For rotation, create the replacement publishable key in Supabase and update
   both Netlify contexts and affected ignored local files. Keep the previous key
   active until deployed consumers have moved to the replacement when possible.
   If a credential is compromised, prioritize revocation and coordinate any
   resulting interruption rather than waiting for a routine release batch.
4. Rebuild the affected previews and verify their commit, successful startup,
   and `/`, `/dashboard`, `/api/health` smoke checks. Public configuration is
   baked into browser assets; editing a dashboard value does not update existing
   deployments. These checks prove app availability, not Supabase authentication
   or key/project validity. Verify actual backend use when that feature exists.
5. Prepare a rebuilt `main` deployment for an explicitly requested production
   batch; keep auto-publishing locked. After release, verify the published
   deployment and retire the old key when no retained consumer requires it.
   Old preview builds retain old keys: rebuild needed previews or retire them
   before revocation. Record only names, contexts, deploy IDs, dates, and results.

VOLO-107's [auth callback contract](auth-callbacks.md) defines exact destinations
and the pending activation/verification work. VOLO-106 does not configure
callbacks or implement authentication. No Netlify values needed changing during
this audit, and no production release or shared-database mutation was performed.

GitHub app CI uses `https://example.supabase.co` and
`sb_publishable_ci_fixture`, deliberately nonfunctional configuration fixtures.
They permit offline builds and public-page smoke tests without real credentials.
Future authentication tests need their own local/disposable backend setup;
these fixtures cannot validate database or login behavior.

## Supabase client factories

Pinned SDK versions: `@supabase/supabase-js` 2.117.2 and `@supabase/ssr` 0.12.7.
Both factories validate the public settings on every call and use generated
`Database` types. Validation errors name variables without exposing values.

Client Components import `createBrowserSupabaseClient` from
`@/lib/supabase/client`. It delegates browser session storage to the SDK and can
also be constructed during server rendering. Do not use it for server identity.

Server Components import `createServerSupabaseClient` from
`@/lib/supabase/server` and await it with `{ cookieMode: "read-only" }`.
Every call creates a fresh client reading the current request's cookies. Never
cache a server client or send it to a Client Component. Read-only clients cannot
persist refreshed sessions; VOLO-114's Proxy will own session refresh.

Writable Route Handlers must explicitly own both cookies and SDK response headers:

```ts
const responseHeaders = new Headers();
const client = await createServerSupabaseClient({
  cookieMode: "read-write",
  setResponseHeaders: (headers) => {
    for (const [name, value] of Object.entries(headers)) responseHeaders.set(name, value);
  },
});
// Perform the intended auth operation and handle its error before returning.
return Response.json({ ok: true }, { headers: responseHeaders });
```

The SDK supplies `Cache-Control`, `Expires` and `Pragma` protections alongside
cookie writes. Preserve these headers and every cookie on replacement responses.
Header failures and prohibited cookie writes propagate; no success should be
reported after persistence fails. Only mutate before response streaming starts.
Server Actions need a response-owning layer that applies these protections;
they cannot set arbitrary HTTP headers through `next/headers`. Do not pass a
no-op header sink. Future auth flows and response handling are separate tickets.

These factories do not authenticate or authorize application access. VOLO-115
will provide verified identity and current membership guards. Run
`npm run test:clients` for loopback cookie integration checks and
`npm run test:boundaries` for compiled client/server boundaries and leak checks.
Neither command uses hosted Supabase or loads the checkout's credential files.

### Previous environment verification

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
