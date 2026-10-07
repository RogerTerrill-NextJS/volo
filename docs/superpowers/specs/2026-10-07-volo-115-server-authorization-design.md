# VOLO-115: Verified identity and current membership

## Intent and scope

Create the shared server-only authorization layer that future protected pages,
reads and mutations can call at their data boundary. A successful check proves
both verified Supabase identity and a current active application membership.
An Auth account or user-editable metadata alone never grants application access.

The user approved this direction on October 7, 2026. This written specification
is the next review artifact; implementation has not started.

Constraints: Next.js 16.3.8 App Router, strict TypeScript, the installed Supabase
SSR/JS SDKs and generated Database types. Use feature/ branches, Netlify Deploy
Previews and production only. Production publishing stays locked. Preview shares
hosted Supabase; all account and membership write tests use disposable local
fixtures. No hosted credentials, email, account mutations or database writes.

VOLO-116 owns dashboard protection and login/access-denied page integration.
VOLO-117 owns mutation wrappers, input validation and cross-origin defenses.
VOLO-118 owns application-wide private caching integration. This ticket supplies
the reusable checks and documents their consumption; it does not create login,
logout, signup, reset, invitation, admin-management or callback flows.

## Existing foundations and approach

VOLO-113 provides fresh request-scoped server clients with explicit read-only or
read-write cookie ownership. VOLO-114 refreshes cookies in Proxy before rendering,
but deliberately performs no membership queries. Independent consumers must still
verify identity and authorization themselves.

The memberships table already has a UUID user_id primary key, member/admin role
and active/disabled status. RLS permits authenticated users to read only their
own membership. Browser clients cannot create or change membership, including
admin clients. No schema migration or service-role access is needed here.

Use one shared layer rather than repeating identity and membership logic at
each call site. Verifying JWT claims locally would reduce an Auth round trip,
but getUser is the selected policy for this ticket: it follows the existing
Proxy approach and verifies the current Auth user through the service. Do not
trust getSession, decoded cookie content, request identity headers or metadata
as proof of identity, role or admission.

The installed Next authentication and data-security guides recommend server-only
data access, minimal returned objects and checks close to data. Their redirect
examples are adapted here to structured outcomes so API consumers can return
HTTP errors without receiving login HTML.

## Public server interface

Place the new interface in lib/auth/access.ts with import 'server-only'.
Types derive member roles from Database rather than duplicating the schema.

- ActiveMember: a readonly object containing only userId and role. No SDK client,
  token, full Auth user, email, metadata, disabled reason or database row escapes.
- getAccess(): resolves a discriminated result with status authorized and member,
  or status unauthenticated, forbidden or unavailable. Denied results contain no
  identity data or raw upstream diagnostics.
- requireActiveMember(): performs a fresh getAccess check and returns ActiveMember
  only on authorized; otherwise throws a typed AccessError with a fixed code and
  generic message.
- requireRole(allowedRoles): performs its own fresh active-membership check and
  returns ActiveMember only if its role is explicitly allowed. Both member and
  admin satisfy requireActiveMember; admin does not silently bypass an explicit
  role restriction. Empty role lists deny. Invalid runtime role inputs cannot
  grant access. Callers associate their operations with explicit allowed roles;
  do not invent a speculative permission catalog or unrelated admin operations.

AccessError codes are unauthenticated, forbidden and unavailable, matching the
result statuses. Page consumers choose their safe redirect or denied state;
API consumers map these to 401, 403 and 503 respectively. The layer itself does
not redirect, construct HTTP responses or accept user IDs from its callers.
Unexpected configuration/programming errors remain exceptions and fail closed;
they are not silently reclassified as a missing membership.

## Verification and membership lookup

Each invocation constructs a fresh read-only server client from the existing
factory, awaits auth.getUser(), and obtains the subject only from that verified
response. Missing sessions and recognized invalid credentials are unauthenticated.
Unknown Auth errors, rate limits, network/protocol failures and service outages
are unavailable. No membership query runs when verified identity is absent.
Validate the returned subject as a nonempty UUID before querying the UUID column;
an invalid successful Auth payload is unavailable and cannot grant access.

Using that same request-scoped client and its ordinary publishable key, query
memberships selecting only user_id, role and status, filter user_id by the verified
subject, and require at most one row. No service-role key, caller-supplied subject,
metadata claim or unfiltered membership lookup is permitted.

- No row or disabled membership: forbidden.
- Active membership with a valid member/admin role and matching user_id: authorized.
- Query error, duplicate/unexpected result, invalid status/role, mismatched subject
  or malformed payload: unavailable. Never infer membership absence from an error.
- A valid active role outside requireRole's allowed list: forbidden.

The authorization layer never inserts membership or changes roles/status, and
never writes cookies. Cookie refresh/persistence stays with Proxy and existing
response-owning auth flows. Checks must remain safe when invoked without Proxy,
including an expired or malformed session: deny or return unavailable rather
than granting access or attempting unauthorized cookie persistence.

## Failure bounds and transport ownership

Auth verification must retain VOLO-114's bounded, sanitized behavior, including
stalled response bodies and unknown rejection codes. Reuse the existing Auth
transport without changing Proxy behavior. If needed, extend the server factory
with an optional caller-owned fetch override; preserve both existing cookie-mode
contracts and defaults. Do not expose a shared mutable SDK client or global fetch
override in application code.

The override routes only this client's Auth requests through the Auth transport;
membership requests need normal PostgREST semantics rather than Auth-payload
validation. Bound membership lookup separately to five seconds, including body
consumption, cancel outstanding work and finish cleanup before settling. The
sequential check therefore has up to five seconds for Auth and five for the
membership service, plus scheduling overhead. A timeout returns unavailable.
Do not leave SDK refresh retries or network work detached after returning.

Raw SDK errors, rejection bodies, tokens and cookies must not enter logs or
returned objects. The existing Auth transport supplies fixed sanitized messages;
membership failures likewise return fixed outcomes without logging upstream
details. Tests use synthetic canaries to verify this contract.

## Freshness, concurrency and consumer responsibilities

Do not add React cache, Next cache directives, unstable_cache, module-level
promises or a membership cache in this ticket. Every independent invocation,
including repeated checks within one request, verifies identity and reads current
membership. This costs extra backend requests but makes revocation and role
changes straightforward and avoids accidental reuse between users or mutations.

A successful check is a decision at the time of the lookup, not a durable grant
or transaction lock. Consumers call the guard immediately before protected data
access or mutation and still rely on RLS and operation-specific database policy.
This ticket does not promise atomicity against an administrator changing access
between the check and a later operation. UI visibility and Proxy are not access
control boundaries. Future consumers must keep private responses uncacheable and
must not serialize errors or full SDK objects to clients.

## Verification design

Use real SDK behavior with fictional loopback Auth/PostgREST responses and a
disposable Next application that imports the real server factory and access
layer. Fixture-only endpoints exercise the result and throwing interfaces with
actual Next request cookie contexts. Never add seeding/test endpoints to the
production app. Keep existing SQL policy tests as independent RLS evidence;
an HTTP stub is not evidence that PostgreSQL policies work.

Cover anonymous, malformed/forged sessions, recognized credential rejection,
active member/admin, absent and disabled memberships, metadata role spoofing,
explicit role denial, empty/invalid role inputs, user isolation and minimum
returned fields. Assert membership filters and bearer identity match the verified
user; rejected/absent identities must trigger zero membership requests.

Change membership status and role between calls using the same unexpired session
and verify the next call respects the change. Exercise concurrent different users
and independent mutation-like checks without rendering-cache assumptions.

Cover Auth and membership errors, unknown rejection codes, network failures,
429/5xx, malformed JSON, invalid successful structures and hanging headers/bodies.
Assert bounded completion, no detached retries, no cookie writes, fixed outcomes,
safe API 401/403/503 fixture mappings and no protected marker on denial. Scan
fixture response bodies, visible headers, browser assets and captured output for
synthetic sensitive canaries. Add a compiled Client Component import prohibition
for the access layer to existing boundary verification.

Run typecheck, lint, production build, regular tests, existing client/Proxy/boundary
checks and the new authorization checks. Local webpack builds are permitted by
the established host limitation; hosted app CI verifies the default bundler, and
database CI independently reruns access policies. Add authorization verification
to CI. After review, create/attach a PR, verify its Deploy Preview's public smoke
suite and browser navigation/refresh, and record evidence in VOLO-115. The
dashboard stays public until VOLO-116. Keep VOLO-115 In Progress until merge.

## Review focus

- A verified user differs from a cookie's embedded identity: only verified subject
  controls membership filtering; mismatched returned rows cannot authorize.
- Unknown Auth errors or membership query failures must not look like anonymous
  success, missing membership, or a valid role.
- Status/role changes with an unchanged JWT and concurrent users must not reuse
  stale authorization.
- A direct guard invocation without Proxy must fail safely for expired credentials,
  without cookie writes, hanging retries or sensitive SDK logging.
- Role requirements must perform a new check; previously returned ActiveMember
  objects are not an authorization token for a later mutation.
