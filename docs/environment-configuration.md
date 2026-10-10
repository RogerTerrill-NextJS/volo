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
persist refreshed sessions; VOLO-114's Proxy owns session refresh.

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

Both cookie modes accept an optional caller-owned `fetch` override. It affects
only that constructed client's network calls and preserves cookie ownership;
it does not change global fetch or other clients. The access layer uses it for
bounded service verification. Do not use it to bypass identity verification.

These factories do not authenticate or authorize application access. Use the
verified identity and current membership guards below. Run
`npm run test:clients` for loopback cookie integration checks and
`npm run test:boundaries` for compiled client/server boundaries and leak checks.
Neither command uses hosted Supabase or loads the checkout's credential files.

## Verified server authorization

Import `getAccess`, `requireActiveMember`, `requireRole` and `AccessError` from
`@/lib/auth/access` in server code. Every call creates a fresh read-only client,
verifies identity through `getUser()` and reads the verified subject's current
`memberships` row through that same client and RLS. The query selects only
`user_id,role,status`. No account metadata, cookie-embedded identity, identity
header or service-role client establishes admission. Membership is never created
automatically. These modules cannot be imported into Client Components.

`getAccess()` returns `{ status: "authorized", member: { userId, role } }` or a
minimal `{ status: "unauthenticated" | "forbidden" | "unavailable" }` result.
`requireActiveMember()` returns only `{ userId, role }` for active memberships.
`requireRole(["admin"])` independently repeats verification and permits only the
explicitly allowed current role. Both member and admin satisfy active membership;
an admin does not automatically bypass a member-only role requirement. Empty or
invalid role requirements deny access. No token, SDK client, email, full user,
metadata or disabled reason is returned.

Guards throw `AccessError` with `code` equal to the failure status and a fixed
generic message. Page consumers choose a safe redirect/denied state. API consumers
map unauthenticated to 401, forbidden to 403 and unavailable to 503; they must not
redirect API callers to login HTML or expose raw exceptions. Missing/invalid
identity is unauthenticated; absent/disabled membership or a denied role is
forbidden. Unknown Auth failures, query failures, timeouts and malformed results
are unavailable. Unexpected configuration/programming errors remain exceptions.

Auth and membership phases each have a five-second deadline covering response
bodies; membership's budget starts on its first fetch. Calls explicitly disable
request caching and PostgREST retries. Unknown failures use sanitized local SDK
responses and separate failure flags; these responses are never browser output.
The layer writes no cookies. A successful refresh attempted without Proxy cannot
be persisted by this read-only check and returns unavailable; run refresh through
the established response-owning flow first. Never use the access guard as login
or session establishment.

No authorization result or client is cached. Repeated calls, even in one render,
read current membership so disabling a user or changing a role is respected with
an unchanged JWT. Call guards immediately before protected reads/mutations and
retain RLS and operation-specific database policies. A check is a decision at
lookup time, not an atomic lock against a subsequent administrator change.
Previously returned member objects are not reusable authorization grants.

The access layer supplies no redirects or HTTP response/cache headers. Consumers
must keep private output uncacheable and check at their data boundary.
VOLO-116's server-only `lib/auth/page-access` adapter adds `getPageAccess()`:
unauthenticated requests redirect to fixed `/login?reason=authentication-required`
(the fixed query prevents Netlify from forwarding incoming parameters); authorized results contain
only the existing minimal member; forbidden/unavailable results render generic
page states. Every page independently checks before constructing protected
content. The presentational `(protected)` layout forces dynamic rendering and
does not grant authorization. Dashboard HTML/RSC and redirects are private,
no-store; the helper itself neither caches a decision nor persists cookies.
VOLO-154 supplies the public `/login` email/password form and native
`POST /auth/login`. Configure `VOLO_MUTATION_ORIGIN` to the exact local app origin
for manual login/logout; hosted builds pin it through the existing Netlify context.
Both login page and POST outcomes are private/no-store. VOLO-155 adds native
`POST /auth/logout` with the same exact-origin policy and fixed login destination.
It clears current-browser auth/setup cookies, uses SDK local-session sign-out, and
refreshes authorization on restored protected documents. See the
[logout contract](auth-callbacks.md#login-destination-agreed-for-volo-116--volo-22). No arbitrary return URL
or query is forwarded to login. Next.js can serialize the incoming URL in its
router payload, so never put credentials in ordinary navigation queries.
Page denial UI can have HTTP 200 under streaming; redirects can use the RSC
protocol. Existing Proxy service failures remain generic HTTP 503. These are
page behaviors, separate from API 401/403/503 mappings.
Already delivered browser content cannot be retracted; new server requests
check current membership. `npm run test:protected-app` verifies actual page
modules with fictional local services. VOLO-117 adds mutation/input/cross-origin
defenses described below; VOLO-118 completes the wider private-cache integration.
`npm run test:access` verifies real SDK/Next behavior with fictional local services,
including safe API status mappings, current membership changes and failure/leak
checks. SQL policy tests separately establish actual RLS behavior. No hosted Auth
or membership writes are required; production publishing remains locked.

## Protected mutations

VOLO-117 provides server-only helpers for future protected member writes.
There are currently no product Server Actions or mutating Route Handlers; only
GET /api/health exists. The verification endpoints/forms live in disposable local
fixtures. A page check or Proxy refresh never authorizes a later write.

### Build-pinned origin

`next.config.ts` validates and inlines non-secret `VOLO_MUTATION_ORIGIN` for each
build. Netlify deploy-preview uses its exact `DEPLOY_PRIME_URL`; production uses
its primary `URL`. Hosted metadata overrides local values. Unsupported contexts,
missing hosted values or malformed origins fail the build. Production publishing
controls remain unchanged, and no additional Netlify variable needs provisioning.
The preview metadata is captured at build time because it is not guaranteed in
the function runtime. Runtime overrides cannot change the compiled guard origin.

Locally set `VOLO_MUTATION_ORIGIN=http://localhost:3000` in ignored `.env.local`
before invoking mutations. Match the actual scheme, host and port; opening
127.0.0.1 instead of localhost is a different origin. Restart/rebuild after a
configuration change. Local read-only builds can omit the value; mutations then
fail closed as unavailable. Use exact loopback HTTP origins in fictional fixtures.

Hosted origins require HTTPS. Configured values contain no credentials, extra
path, query, fragment, list or wildcard. A preview trusts only its own stable
preview URL, not sibling previews, production or its immutable deploy permalink.
Production aliases/custom domains need a deliberate configuration change. Never
use request Host, X-Forwarded-Host, Forwarded, Referer or URL to establish trust.

Each request needs an exact matching Origin. Missing, null, malformed, multiple,
external or different-port/scheme values fail. If supplied, Sec-Fetch-Site must
be same-origin or none; same-site also fails. No cross-origin CORS grant is added.
Next's additional Server Action Origin-vs-host check stays enabled with no
allowedOrigins expansion. Its missing-Origin/forwarded-host behavior is weaker
than this guard, so every protected action still invokes the shared wrapper.
This browser-cookie policy does not defend against XSS/stolen cookies or serve
non-browser integrations; those need an explicit separate design.

### Consumer contract

`MutationPolicy<I,O>` requires explicit `allowedRoles`, `parse`, `authorize` and
`effect` callbacks. After origin validation, the helper independently rechecks
identity/current membership, validates roles and input, and requires literal
true from operation-specific authorization before invoking the effect once.
Parser failures return `{ok:false}`; successful parsers return `{ok:true,value}`.
Throwing callbacks become generic internal failures. Permission callbacks must
be side-effect-free; apply resource ownership/business rules, not roles alone.

Route Handler usage, where `updatePolicy` is an operation-owned
`MutationPolicy<Input,MinimalResult>` with all four required callbacks:

```ts
import {handleRouteMutation} from "@/lib/auth/route-mutation";
import {updatePolicy} from "./update-policy";

export async function POST(request: Request) {
  return handleRouteMutation(request, {method: "POST", policy: updatePolicy});
}
```

The operation policy module is supplied by the future feature; this example does
not introduce an endpoint. JSON adapters support explicitly selected POST/PUT/
PATCH/DELETE. Export only supported mutation methods. Next rejects unexported
methods; the adapter also rejects mismatches with 405/Allow. If exposing OPTIONS,
reject rather than grant credentialed cross-origin access.

JSON accepts application/json with optional UTF-8 charset, defaults to 16384 actual
bytes and permits positive integer operation overrides up to 65536. Counting
does not trust Content-Length. Invalid/incomplete/failed JSON reads return 400,
oversize 413, media mismatch 415. The helper's five-second read deadline starts
when it reads the body. Next Proxy can buffer the incoming upload before the
handler starts; this deadline is not an end-to-end ingress timeout. Hosting/
framework upload limits remain necessary. The reader cancels on failure and
does not collect oversized content into a DTO.

Action usage inside a future feature's explicit 'use server' entry point:

```ts
"use server";
import {handleActionMutation} from "@/lib/auth/action-mutation";
import {updatePolicy} from "./update-policy";

export async function update(_previous: unknown, form: FormData) {
  return handleActionMutation(form, updatePolicy);
}
```

Use the result with useActionState or direct client invocation. The wrapper reads
real Next request headers; no action argument may supply member identity or origin
evidence. Application FormData allows unique text fields only, no Files, with
16384 aggregate UTF-8 bytes including field names. Next owns reserved $ACTION_
metadata and strips it for native decoding; when present to the normalizer it
counts toward the limit but never reaches business input. Parsers reject unknown
application fields and validate exact schema/lengths. Next's raw Action body limit
is 64 KiB including multipart overhead. Uploads need a separate design.

Both adapters return `{ok:true,data}` or `{ok:false,code,message}` with minimal
serializable output. JSON status mapping: unauthenticated 401; origin/membership/
role/resource denied 403; unavailable 503; invalid input 400; oversize 413;
unsupported media/method 415/405; internal error 500. Every adapter-created HTTP
response is private/no-store. Next controls Action HTTP/RSC status and no-store
headers; inspect semantic codes instead of assuming failure equals HTTP 403.
Existing Proxy Auth outages may return generic text 503 before either wrapper.

Effects use caller-scoped publishable-key clients and retain RLS. Never trust
input role/user ID, cache an authorization result, or create privileged clients
before authorization. Return an explicitly constructed minimal DTO, not full
users/sessions/clients or raw exceptions. Cookie writes remain owned by existing
response-aware client flows; these helpers establish no session and mutate no
cookies. Do redirects/revalidation explicitly after successful wrapper completion,
outside the effect callback, so navigation control flow is not swallowed.

A fresh pre-check is not an atomic lock against revocation/resource changes.
Effects need their own transactional database constraints and idempotency where
required. Exceptions after a write produce a safe error but do not roll back that
write or trigger automatic retries. Keep side effects out of parsers/authorization.

`npm run test:mutations` exercises real production-built Next API/fetched Action/
native form transports with fictional sessions, an independent effect recorder,
origin spoofing, revoked access, bounded input and sanitized errors. Unit tests
cover pure configuration/request/body policy. Database CI separately proves RLS;
the effect recorder does not prove SQL transactions. Hosted authenticated mutation
integration remains the responsibility of the first actual feature consumer.

## Proxy session refresh

`proxy.ts` delegates to the server-only `refreshSupabaseSession` helper in
`lib/supabase/proxy.ts`. It creates a fresh SDK client per request and verifies
with `getUser()`. This makes an Auth request for session-bearing application
requests, including prefetches; it performs no membership query. Server-side
identity/membership guards (VOLO-115) and application protection (VOLO-116) remain
required. The dashboard now independently checks verified identity and active membership.

Requests without this project's session cookie/chunks pass through without an
Auth call. A PKCE verifier alone does not count as a session. The literal matcher
covers application pages/APIs, including future auth routes and dotted paths;
it excludes exact `/auth/confirm`, `/auth/login` and `/account/complete`, whose
handlers own session changes after origin/input checks, as well as Next
static/image assets and exact `/api/health` (with optional trailing
slash), favicon/robots/sitemap and the five existing public SVG files. Add new
public asset paths to the matcher and its tests. Do not bypass all dotted paths.

The Proxy forwards refreshed cookies to the current request and the browser,
preserving chunk removals and SDK options. All session-bearing responses use
`Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`,
`Expires: 0` and `Pragma: no-cache`, including requests without a refresh.
Invalid credentials become anonymous after clearing only this project's session
cookies; unrelated cookies and a pending PKCE verifier survive. No login
redirects are introduced.

Network errors, timeouts, rate limits, invalid Auth payloads and Auth server
failures return the generic uncacheable HTTP 503 `Authentication service unavailable.`
and do not erase a potentially valid session. A completed token rotation before
a later user-service failure is still persisted. The per-request Auth transport
has a five-second total deadline covering headers and bodies. It converts
temporary failures into a fixed local terminal SDK response to stop retry loops;
a separate failure flag enforces the browser's 503 policy and prevents the SDK's
resulting cleanup from deleting valid cookies. That local response is never
returned to the browser or treated as a credential rejection. Rejection details
are sanitized before SDK logging; unknown codes conservatively fail with 503.

`refreshSupabaseSession(request)` returns `{ response, finalizeResponse }`.
Return `response` normally. Future same-request redirects/replacements must pass
their `NextResponse` through `finalizeResponse` and return that exact result to
preserve cookies and cache policy. Failed verification cannot be replaced with
a successful response. The finalizer does not copy incoming/internal forwarding
headers onto a replacement. Do not serialize the SDK client/session or trust a
browser-supplied identity header.

`npm run test:proxy` runs focused real SDK tests and a disposable Next.js fixture
with loopback Auth. It covers refresh persistence/current-request cookies,
concurrent users, replacement responses, PKCE-safe cleanup, cache headers and
outages including stalled response bodies. No hosted Supabase account, email,
callback allowlist or data mutation is needed. Production publishing stays locked.

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

## Private response caching

See the [VOLO-118 cache contract](private-caching.md) for the five browser/CDN
headers, protected path registration, SDK header-sink ownership and request-scoped
authorization. Public/static caching is preserved. The deterministic suites use
fictional local services; hosted preview verification remains anonymous. The
separate [real Auth integration suite](session-integration.md) uses an owned
disposable Supabase stack and does not read hosted environment files.

### Invitation confirmation keys and cleanup (VOLO-122)

`VOLO_CONFIRMATION_KEYS` is server-only runtime JSON:
`{"active":"current","keys":{"current":"<base64-encoded-32-byte-key>"}}`.
Each key ID contains 1–32 ASCII letters, digits, underscores or hyphens. Use one
active key and optionally one retiring key. These examples are placeholders.
Missing or invalid configuration makes confirmation unavailable without breaking
other routes. Never put these keys in public variables, source control or logs.

For rotation, deploy the new active key while retaining the previous key in the
same `keys` object. Keep the retiring key for at least the ten-minute transport
lifetime plus deployment overlap, then remove it. Setup cookies use digests and
are independent of transport encryption keys. Crypto tests cover both keys.

Migration `20261009030000` installs `pg_cron` and the named
`volo-invitation-confirmation-cleanup` job every five minutes. Transport stores
retain encrypted provider material for at most ten minutes, claim it once, and
erase ciphertext on claim or same-browser replacement. Cleared tombstones count
against 60 creations per minute per origin and the global 1,024-row cap until
expiry. Cleanup runs without subsequent web requests. The separate setup grant
expires 30 minutes after database creation; cleanup removes it and clears only a
matching live setup snapshot. Invitations themselves have no age expiry.

Hosted activation requires separate approval because Deploy Previews and
production share Supabase. Before activation, verify the migration, restricted
service RPC grants, active cleanup job and successful job executions; provision
runtime keys; review the exact callback allowlist/email templates; and establish
that hosting/proxy/observability ingress logs exclude `token_hash` and `resume`
query values. Application responses and diagnostics contain neither value, but
application code cannot prove platform ingress log redaction. Do not activate
hosted email links until that gate is satisfied. Production publication remains
locked. No hosted database, Auth, keys or templates were changed for this ticket.
