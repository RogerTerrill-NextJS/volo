# VOLO-122: invitation confirmation and setup authority

Status: written design approved by Roger. The invitation flow and scope
were approved in chat. This document specifies their implementation; it does not
claim that routes, migrations, provider behavior or hosted configuration are ready.

## Outcome and scope

An invited recipient explicitly accepts a provider email link, receives persisted
Auth cookies, and reaches `/account/setup` with separate server-owned authority.
No membership is created. Invitations never expire because of age; provider links,
confirmation transport and setup authority have separate finite lifetimes.

The approved [activation contract](2026-10-07-volo-121-invitation-contract-design.md)
and [persistence contract](2026-10-07-volo-127-invitation-schema-design.md) remain
authoritative. This implements their concrete transport and setup store using
existing Postgres, Node crypto, Supabase clients and disposable Auth fixture.
An in-memory store cannot survive separate serverless requests; a separate cache
service adds infrastructure without a required capability. Neither is selected.

Password entry belongs to VOLO-123; password success and activation belong to
VOLO-124/30. Ordinary recovery belongs to VOLO-23. No generic token service,
additional Auth stack, dependencies, login UI, member invitations or history UI.
Keep `feature/` branches and the current checkout. Deploy Previews and production
only; previews share hosted Supabase. No hosted migrations, keys, emails, account
changes or publication are authorized by this implementation design.

## Request flow

1. `/auth/confirm` is a Node Route Handler, outside the protected layout.
   Exclude exactly this route from the session proxy so incoming Auth cookies
   cannot cause refresh, rotation or an outage response before confirmation.
   It owns its private response headers and all writable cookie handling.
2. GET accepts bounded, unique `token_hash`, `type`, optional `flow=invitation`
   and optional `resume` parameters. Reject unknown/duplicate parameters,
   unsupported types, malformed secrets and excessive URL length. Initial
   issuance requires `invite` without a resume proof; resend accepts `invite`
   or `recovery` only with a valid recorded proof. Ordinary recovery without
   proof fails closed for now. Query flags are routing hints, never authority.
3. A valid token-bearing GET creates only encrypted confirmation transport and
   an opaque cookie, then returns 303 to the fixed clean `/auth/confirm` URL.
   It never verifies the token, creates setup authority or changes Auth state.
   HEAD and recognized prefetch requests create no transport and perform no Auth
   operation. Unsupported methods have safe private responses.
4. Clean GET reads the transport through its cookie and returns a small accessible
   HTML form with an explicit **Accept invitation** button. The only hidden input
   is a transport-bound random CSRF value. No provider token, resume secret,
   identity, invitation ID, version, session or ciphertext appears in HTML/RSC.
   Use a Route Handler HTML response so this token boundary requires no client
   component, JavaScript, third-party asset or prefetch.
5. POST accepts only the CSRF field in bounded URL-encoded form data. Reuse
   `checkMutationOrigin` against build-pinned `VOLO_MUTATION_ORIGIN`; require exact
   Origin and reject conflicting fetch metadata. Never trust Host, forwarded Host,
   request-selected destinations or caller identity. Validate CSRF against the
   cookie's transport before any provider operation.
6. Atomically claim transport and erase its encrypted material before invoking
   `verifyOtp` once. Concurrent POSTs cannot both verify. No automatic retry of
   an ambiguous provider verification. Authenticate through the existing writable
   request-scoped client and apply its private header sink before cookie writes.
7. Verify the returned access token with SDK `getClaims`, and freshly verify the
   user with `getUser` using that same token. Require matching nonanonymous subject,
   verified current email, valid UUID `session_id`, expected issuer/audience and
   unexpired claims. A decoded token or `getSession().user` is never authority.
   Missing or failed evidence denies setup; test the pinned real provider behavior.
8. Resolve the invitation from trusted subject/email and captured resend proof,
   use the existing eligibility check, then recheck under the invitation lock in
   the setup transaction described below. On success set a new opaque setup cookie,
   clear confirmation cookie and redirect 303 only to `/account/setup`.

All responses, including failures and redirects, use private/no-store browser
and CDN headers, `Referrer-Policy: no-referrer` and a restrictive CSP with
`default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`.
Escape dynamic text; fixed messages reveal no account existence. Never log raw
URLs, request bodies, SDK errors, tokens or cookie values. Clean failures distinguish
unavailable service from unusable link without disclosing identity.

## Transport persistence, crypto and limits

Add `invitation_confirmation_transports`, a server-only RLS table. Store a SHA-256
lookup digest, CSRF digest, exact trusted origin, creation/expiry timestamps, key ID, encryption
nonce, authenticated ciphertext/tag and claimed timestamp. A random 32-byte
base64url cookie is the lookup credential; the database never stores its plaintext.
The encrypted bounded payload contains provider token hash, provider type, optional
resume secret and random 32-byte CSRF value. No Auth access/refresh token is stored.

Use AES-256-GCM with a fresh 12-byte nonce. Authenticate a fixed purpose/version,
lookup digest, origin and expiry as additional data. Reject malformed envelopes,
unknown key IDs and failed authentication before parsing. Check all lengths and
expiry again on read/claim. Transport expires after 10 minutes by database time.
Expiry makes it unusable immediately; it does not expire the invitation.

Runtime server-only configuration is `VOLO_CONFIRMATION_KEYS`, a JSON object with
`active` key ID and a `keys` map of canonical base64 32-byte keys. Permit at most
two keys: active plus retiring. Never expose values through `NEXT_PUBLIC_*`,
Next's build-time `env` injection, errors or artifacts. Missing/malformed keys make
only confirmation unavailable, leaving existing public and admin flows usable.
Owned fixtures generate ephemeral keys. Hosted provisioning is a separate approved
operation. Rotate by deploying both keys with the new active ID, then deleting old
key material after old transport has expired and cleanup has been verified.

Use atomic server-only RPCs for create, read and claim. Claim locks a row, checks
origin, expiry and CSRF digest, returns its encrypted payload once and clears the
ciphertext, nonce and tag. Keep only the bounded creation/claim tombstone until
expiry for rate accounting; clean GET cannot retrieve a claimed payload. Failed
CSRF or origin cannot consume a legitimate transport.

Creation takes a transaction advisory lock, purges expired rows and enforces a
global maximum of 1,024 retained transports and at most 60 creations per minute
per trusted origin, counting claimed rows too. Do not rate-limit by attacker
controlled forwarding headers. Replacing a browser's transport clears the old
encrypted payload but retains its rate tombstone. Limits bound anonymous storage
and creation; they are not a promise of denial-of-service immunity.

Include a specific expiry cleanup SQL function and a five-minute database cron
job in the migration, with matching local tests and teardown. Cleanup removes
expired ciphertext even when application traffic stops. `pg_cron` availability
must be verified in the existing disposable Supabase stack; migration fails if
the required cleanup cannot be installed. No hosted activation before this job
and runtime configuration are applied and verified through a separately approved
operation. Retention after logical expiry is at most the cleanup interval under
normal scheduler operation; database backups follow their separate retention.

Hosted opaque cookies are Secure, HttpOnly, SameSite=Lax, host-only and Path=/,
using `__Host-volo-confirmation` and `__Host-volo-setup`. Max-Age values are 600 and
1800 seconds respectively. Local loopback HTTP uses explicit unprefixed development
names and Secure=false. Production configuration never infers this exception from
request headers. Existing standard Auth cookies retain the existing SDK contract.

## Setup authority and atomic invitation transition

Add `invitation_setup_authorizations`, also server-only with RLS and no client-role
grants. Store correlation UUID, SHA-256 setup-cookie digest, invitation FK/version,
verified user FK, verified Auth session UUID, origin, creation and expiry timestamps.
No provider tokens, password, Auth session tokens or plaintext lookup credential.
Allow at most one current setup record per invitation; FK deletion uses explicit
owned cleanup, consistent with existing restricted Auth references.

`recordVerifiedSetup` is a service-role-only transaction with a fixed search path.
The server supplies provider-verified identity/email/session evidence, cookie
digest and expected generation; these are never request inputs. Under the
invitation lock it checks current bound subject/email, eligible state and version,
no existing membership, non-banned Auth user and accepted current send evidence.

For initial issuance require the current accepted attempt to be `initial` and
the provider type `invite`, with no resume proof. An original initial link cannot
establish setup after renewal merely because the same Auth subject verified.
For resend require the exact current accepted attempt, matching transport and
resume digest and unused proof. Consume that proof inside this same transaction
with setup insertion and invitation update; separate successful RPC calls are
insufficient. Preserve the existing proof-consumption fixture API if needed,
but production confirmation must use the combined transaction.

Set `status=setup_verified`, verified subject/time and setup correlation ID;
clear previous password evidence and replace prior setup authority. Do not bump
the send generation or insert/upsert membership. Check all state constraints
and roll back proof consumption if setup insertion/update fails.

Setup authority expires 30 minutes after database creation. A server-only
`readVerifiedSetup` interface for subsequent tickets requires opaque cookie,
fresh verified subject/email/session, exact origin, unexpired setup record and
the invitation's matching current version/correlation/state. Auth refresh may
retain the same verified session ID; another login/session does not inherit setup.
Revocation, supersession, renewal and redemption deny old setup immediately even
before physical cleanup. Cleanup deletes expired setup rows and clears only their
matching invitation correlation/verification/password snapshot, returning a still
live setup row to `issued`. Terminal invitations retain their required historical
verification/password snapshot; deletion of expired authority does not erase
redemption evidence. Terminal state and invitation age remain unchanged.
It must lock and compare correlation/version to avoid erasing newer setup.

No password page is delivered in this ticket. Existing shared fixture can invoke
the real setup reader to prove the cookie and server-visible session, while the
fixed destination remains VOLO-123's UI handoff.

## Failure and deployment boundaries

Provider verification, database writes and cookie delivery cannot be atomic.
Lost provider response, a consumed transport, failed verified-session evidence,
failed setup transaction or lost setup cookies grant no app membership. Require
a fresh eligible provider link after ambiguous/consumed verification. Never infer
setup from account confirmation, metadata, a session alone or correlation UUID.
Do not automatically resend, repeat verification or delete an Auth user.
On post-verification failure clear the newly issued Auth cookies and any setup
cookie before returning the private failure response; do not deliver a successful
session/setup redirect. This explicit acceptance may replace a prior browser
session; no failed confirmation restores prior setup authority.

Use bounded no-store outbound transports with redirect refusal and deadlines
covering response bodies, following existing Auth/service adapters. Preserve
existing client/header interfaces; any required change must retain their tests.
New migrations add stores/functions/cleanup; old migrations stay unchanged and
types regenerate with pinned tooling. No broad store framework or unrelated refactor.

Hosted email-link ingress may log token-bearing URLs before application code runs.
Platform/provider log redaction or exclusion and cleanup/key provisioning must be
verified before hosted activation. Route code alone does not establish those facts.
Implement and test locally; keep hosted confirmation unavailable without its keys.
Production publishing remains locked and separate from merging.

## Verification and handoff

Extend the existing real Auth/mail/Next fixture; do not create another app/stack.
Reuse captured links from existing issuance/renewal scenarios where lifecycle
permits. Add scenarios only where genuine new concurrency or failure risk requires
them. Disposable CI is the provider/database acceptance gate; hosted write tests
remain outside scope.

Prove actual initial invite and invite/recovery resend POSTs, persisted standard
Auth cookies and setup-cookie/session binding, with no membership or dashboard
admission. Cover GET/HEAD/prefetch non-consumption, missing/foreign Origin, CSRF,
duplicate/excess inputs, invalid/replayed tokens, unsupported/ordinary recovery,
wrong subject/email/session, stale generations, terminal invitations, expired
transport/setup, old eligible invitations and concurrent acceptance.

SQL tests prove RLS/grants, caps/rate accounting, cleanup without traffic, atomic
proof-plus-setup rollback, no overwrite of existing memberships and invitation
cleanup races. Focused unit tests prove envelope tampering, key rotation, safe
parsing and token-free presentation; fixture leak scans cover HTML, RSC, URLs,
static bundles, logs and response bodies while allowing intended Set-Cookie only.
Run relevant existing typecheck, lint, build and Auth/cache/boundary checks.
Use one final independent implementation review, then final-commit CI and preview.

Implementation starts after written-spec approval and a reviewed implementation
plan with an execution-method choice. No product code is included in this stage.

## References checked for this design

- Installed Next Route Handler and asynchronous cookies guides under
  `node_modules/next/dist/docs/`; a page and Route Handler cannot share a segment.
- Pinned SDK `GoTrueClient.getClaims` and existing writable server client/proxy.
- [Supabase verified claims](https://supabase.com/docs/reference/javascript/auth-getclaims).
- [Supabase email templates and scanner-safe acceptance](https://supabase.com/docs/guides/auth/auth-email-templates).
