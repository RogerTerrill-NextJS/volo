# VOLO-117: Protected mutation boundaries

## Intent and approved direction

Make future cookie-authenticated writes independently verify the caller, current
active membership, operation permissions, input and request origin before effects.
Page navigation, hidden controls and Proxy refresh never grant permission to write.

The user approved shared server-only helpers and disposable local Action/API
fixtures on October 7, 2026. This document is the written specification for review;
product implementation has not started.

Use Next.js 16.3.8, installed Supabase clients, generated Database types and the
VOLO-115 authorization layer. Work on feature/ branches. Use Deploy Previews and
production only; preserve production publishing controls and perform no release.
Previews share hosted Supabase: authenticated tests and all write fixtures remain
fictional and local. No new dependencies, migrations, privileged clients, product
mutation endpoints or forms are needed.

## Inventory and alternatives

The current app has no Server Actions or mutating Route Handlers. Its only Route
Handler is GET /api/health, with Next's method handling. Dashboard/login pages are
read-only. Existing requireActiveMember/requireRole verify identity and fresh
membership; server clients require explicit cookie ownership.

Selected approach: small shared mutation guard plus Route Handler and Server
Action adapters. Repeating policy in each feature risks inconsistent checks.
A synchronizer-token subsystem adds storage and lifecycle work without a current
consumer. Exact trusted-origin checks suit the current browser-only cookie policy;
future non-browser integrations require a separate explicit authentication design.

## Trusted origin configuration

Use one exact origin per built application, with no wildcard or request-derived
fallback. Resolve and validate it in next.config.ts during the build, and expose
the resulting non-secret constant to server mutation code through Next's env
inlining. Keep its resolver usable by configuration/tests without importing
server-only code. The origin is not a credential; do not place secrets in this
configuration mechanism.

| Build context | Trusted input |
| --- | --- |
| Netlify deploy-preview | DEPLOY_PRIME_URL |
| Netlify production | URL |
| Local development and fictional CI fixtures | Explicit VOLO_MUTATION_ORIGIN |

Netlify context takes precedence over local overrides. Accept no other hosted
context and never trust all previews on a site. A preview trusts its own stable
preview URL, not production, sibling previews or deploy permalinks. Production
trusts its configured primary site URL. Aliases need a future deliberate policy
change. Do not add serverActions.allowedOrigins wildcard entries.

Validate configuration as an origin only: HTTPS for hosted contexts; HTTP allowed
only for exact loopback hosts locally; no credentials, non-root path, query,
fragment, list or wildcard. Compare full canonical origin including scheme and
port. Reject malformed values with sanitized configuration errors.

Hosted builds with missing/invalid origin or an unsupported context fail. For a
local build with no configured origin, existing read-only pages may still build;
mutation calls fail closed as unavailable. Local developers who invoke mutations
must set the exact local origin, including port. A production build pins its
origin; changing runtime environment or request headers cannot replace it.

Netlify documents DEPLOY_PRIME_URL as build metadata, but only URL/SITE_NAME/SITE_ID
as guaranteed read-only function runtime variables. Build-time capture avoids
relying on an absent runtime preview value:

- https://docs.netlify.com/build/configure-builds/environment-variables/
- https://docs.netlify.com/build/functions/environment-variables/

## Shared guard and sequencing

Keep all mutation helpers server-only. Use typed success/failure results and
generic messages, without raw service errors, submitted values or token details.
No helper is itself an exported Server Action or public endpoint.

Every adapter follows this order:

1. Check supported method where applicable, origin configuration and request
   origin. Reject before parsing the body or invoking Auth on invalid evidence.
2. Independently call the existing fresh access check. Fail on missing/rejected
   credentials, absent/disabled membership or unavailable verification.
3. Check an explicit nonempty allowed-role policy and reject unsupported roles.
4. Read/validate bounded input using an operation-specific parser.
5. Run a required operation-specific authorization callback with verified minimal
   member identity and validated input. It must be side-effect-free; false denies.
6. Only then invoke the effect callback once, with the verified member and typed
   input. Never construct a privileged client before authorization.

Require policies explicitly rather than defaulting an omitted policy to allow.
Authorization callbacks support resource ownership/business rules; allowed roles
alone do not authorize arbitrary resources. All permission-relevant resource
state must be read freshly, and downstream writes must retain RLS and transactional
constraints against races. The helper cannot make a pre-check and later write
atomic, retract completed writes, or enforce idempotency automatically.

Ordinary effects use publishable-key clients with the caller's cookies and RLS.
Do not substitute service-role credentials or trust a user ID/role from input.
Do not cache access decisions across requests. Preserve the existing Proxy cookie
refresh and response-header contract; this ticket does not introduce cookie
mutation or a new refresh policy.

## Origin and CSRF policy

Require exactly one valid Origin header whose serialized origin equals the pinned
trusted origin. Reject absent, null, malformed, multiple/comma-separated origins,
credentials, path/query/fragment components, alternate scheme or port, sibling
previews and external sites. Host, X-Forwarded-Host, Forwarded, Referer and the
request URL never establish trust. If Sec-Fetch-Site explicitly says cross-site
or same-site, reject it; accept same-origin, none or absence only with a valid
matching Origin. No credentialed cross-origin CORS responses or preflight grants.

This protects browser cookie requests: JavaScript cannot freely set Origin.
Non-browser clients can forge headers but still need valid credentials and
authorization. This policy does not defend against same-origin XSS or stolen
cookies. Missing Origin is intentionally unsupported, including old clients.

The installed Next Server Actions guide and action-handler implementation use
POST, compare Origin host with Host/X-Forwarded-Host, and allow missing Origin
with a warning. Retain those framework defenses and add the shared stricter check
inside every protected action. The app check therefore still denies a forged
matching forwarded host or missing origin if the framework invokes the action.

## Route Handler adapter

Provide a JSON mutation adapter for POST, PUT, PATCH or DELETE selected explicitly
by each consumer. Unsupported methods receive 405 with Allow; OPTIONS must not
grant cross-origin writes. A consumer exports only the intended method functions
and routes every supported mutation through the guard.

Accept application/json with optional charset=utf-8. Reject other media types
with 415. Enforce a default maximum of 16 KiB of actual streamed bytes, not just
Content-Length. Permit only a positive operation limit at or below 64 KiB.
Reject oversized bodies with 413, including absent/misleading length headers;
cancel further reads. Bound the read to five seconds, returning a generic 400
on incomplete/failed input. Reject malformed JSON, unexpected shape/fields and
schema failures with 400 using the operation parser. No automatic coercion.

Required parser and authorization callbacks return typed validation/permission
results; thrown exceptions are internal failures, never mistaken for success.
Effect exceptions also fail safely in the response, but may occur after a write:
do not automatically retry or claim rollback. Consumers own transactions and
idempotency where partial effects matter.

Return generic JSON errors: unauthenticated 401; origin, membership, role or
operation denial 403; unavailable access/configuration 503; unexpected failures
500. All adapter-created responses, including success, carry private/no-store
cache headers. A successful effect returns an explicitly constructed minimal
serializable DTO; never serialize the client, full user, session or arbitrary
exceptions. Consumers own any future cookie-bearing response integration.

## Server Action adapter

Provide a callable server-only wrapper for use inside a feature's explicit
async 'use server' entry point. Read actual request headers through next/headers;
never accept request evidence or member identity as action arguments.

Accept bounded FormData input suitable for ordinary small forms. Reject Files,
unexpected duplicate fields and aggregate field data above 16 KiB; the operation
parser rejects unknown fields and validates types/lengths. Measure UTF-8 bytes,
including names, and reject invalid data before effects. Configure Next's raw
Server Action bodySizeLimit to 64 KiB, allowing multipart overhead while bounding
framework parsing. Uploads are outside this contract and need a later design.

For native forms, distinguish Next's compiled action-selection metadata from
application fields using the installed framework's decoding behavior. Framework
metadata never authorizes an operation and never reaches the effect input; test
native submissions with extra application fields rather than assuming every raw
FormData field belongs to the business schema.

Return a serializable success/failure union using the same semantic codes as the
Route Handler. Next controls the wire status for Action/RSC responses; tests must
not assume an action error code becomes the HTTP status. Expected errors are
sanitized. Unexpected callback exceptions become a generic internal failure.
Effects that redirect/revalidate must do so explicitly outside this result-based
wrapper after success; do not swallow Next navigation control-flow exceptions
inside a callback. Document this restriction for downstream consumers.

## Verification and handoff

Add pure unit tests for origin/configuration/body/input policy and an actual
production-built Next integration fixture using real existing auth/membership
helpers and fictional SDK sessions. Fixture routes/actions live only in owned
temporary directories, never product app routes or hosted deployments.

Discover actual Action IDs from the fixture build/form output. Invoke actions and
APIs directly without prior dashboard navigation. Test fetch/RSC Action transport
and native multipart form submission so the custom check cannot be bypassed by
the transport. Verify installed Next's external-origin rejection independently
from the stricter helper, including the missing-Origin framework behavior.

Cover successful member/admin policies; missing, malformed, forged and revoked
cookies; disabled/absent membership; role spoofing and forbidden resource access;
revocation between requests using the same JWT; Auth/membership outage; missing,
null, malformed, sibling-preview and external origins; spoofed Host/forwarded
headers; unsupported methods; wrong content type; malformed/oversized/slow JSON;
invalid, duplicate and file form inputs; parser/authorization/effect exceptions;
separate concurrent callers; and minimal sanitized results/cache protections.

Record effect invocations independently of successful responses. Every denied
case must prove zero effect calls/writes; each valid case produces exactly one
intended fictional effect under the verified user. Bound and block all fixture
outbound requests except its loopback backend. Scan outputs/assets/responses for
credential/error canaries. Keep database RLS CI as separate evidence; an effect
counter does not prove SQL policies or transactions.

Wire test:mutations into CI, include new modules in compiled server-only boundary
checks, and retain existing smoke/client/Proxy/access/protected-app tests. Update
environment docs, .env.example and the auth handoff for VOLO-21/22/23: every
protected write needs an independent guard; pre-membership login/signup/reset
flows need their own admission/CSRF policy and cannot blindly require membership.

Open a PR after implementation and verification. Run anonymous read-only preview
smoke checks against its exact head; do not ship a test mutation endpoint to obtain
hosted write coverage. Record CI, deploy and local fixture evidence in VOLO-117.
Leave it In Progress until merge verification. Hosted authenticated mutation
integration remains a downstream consumer responsibility because no real product
mutation exists in this ticket.
