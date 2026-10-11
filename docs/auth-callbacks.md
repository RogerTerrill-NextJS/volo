# Auth callback contract

VOLO-107 uses exact callback URLs for local development, production, and
individually reviewed Netlify Deploy Previews. There is no staging environment.
Hosted configuration remains a separately approved operation. Implemented local
signup and exact-preview evidence are recorded below.

## Current state

The hosted Supabase URL Configuration was inspected on October 6, 2026:

- Site URL: `https://voloapp.netlify.app`.
- Redirect URLs: empty.
- No changes were made to hosted Auth settings.

The invitation confirmation, password setup and atomic membership redemption
flow is implemented and tested with disposable real Auth. VOLO-154 supplies
public `/login` email/password sign-in, VOLO-155 supplies current-browser logout,
and VOLO-156/157 supply ordinary recovery requests, confirmation and reset.
Hosted mail configuration remains separate. Local signup evidence does not establish hosted
enablement. VOLO-107 stays
In Progress until configuration and valid/invalid redirect tests are complete;
its documentation PR alone does not complete the ticket or VOLO-110.

Local `supabase/config.toml` currently uses Site URL `http://127.0.0.1:3000`
and additional redirect `http://localhost:3000`. It has not yet been changed to
the callback contract below. The owned integration harness overrides its copied
configuration with its exact loopback `/auth/confirm` callback; the checked-in
developer config still needs the two entries below for manual callback testing.
Local configuration does not update hosted Auth.

## Exact destinations handed to VOLO-107

| Auth service | Application | Required callback entry | Status |
| --- | --- | --- | --- |
| Local Supabase | Local app on localhost | `http://localhost:3000/auth/confirm` | Route implemented; manual local config update pending |
| Local Supabase | Local app on loopback IP | `http://127.0.0.1:3000/auth/confirm` | Route implemented; manual local config update pending |
| Hosted Supabase | Production | `https://voloapp.netlify.app/auth/confirm` | Pending route release and hosted configuration |
| Hosted Supabase | One approved PR preview | `https://deploy-preview-<PR-number>--voloapp.netlify.app/auth/confirm` | Pattern for an exact entry; replace with a reviewed PR number before adding |

VOLO-126 verified anonymous routing on PR #37 at commit
`6a4296ea0d3fb5e2a8d932837c1239b7082262af`. Its exact callback candidate is
`https://deploy-preview-37--voloapp.netlify.app/auth/confirm`; this is a handoff,
not approval or evidence that hosted Auth allows it. PR #37 is closed, so use a
current reviewed PR for any later authenticated review and retire closed entries.
See [exact-preview evidence and hosted checklist](preview-verification.md#volo-126-account-signup-handoff).

The callback path is `/auth/confirm`, without a trailing slash. Preserve the
production Site URL as the default; do not point it at a PR. Normally use local
Supabase for local Auth tests. A local app connected to hosted Supabase is not
isolated: adding its callback to hosted Auth requires a separate reviewed need.

A PR's numbered Deploy Preview hostname stays stable across builds of that PR,
so it is the callback destination for that review. It is not a permanent preview
environment. Before allowing it, review the exact revision's callback handler,
dependencies, and handling of credentials, and verify the actual deploy URL.
Any later PR push can replace the code at that allowed hostname: pause Auth
testing and remove its entry until the new revision is reviewed. Do not approve
untrusted fork authentication just because Netlify can build it.

Never add a site-wide preview wildcard, an arbitrary hostname supplied by a
request, or an immutable deploy URL as a substitute for this approved PR URL.
Do not forward tokens or sessions from a production callback to a preview.
Separate origins establish their own cookies. Remove preview entries after
review closes, and remove entries for superseded or untrusted revisions.
Previews still share the production database and Auth user pool; the allowlist
does not make them read-only or provide backend isolation.

## Callback implementation handoff

### Mutation boundary handoff for VOLO-21 / VOLO-22 / VOLO-23

Protected member writes use VOLO-117's independent JSON/Server Action guards and
the [mutation contract](environment-configuration.md#protected-mutations).
Each operation supplies an explicit role policy, schema parser, side-effect-free
permission callback and caller-scoped RLS effect. Page/Proxy checks grant no
write permission. Preserve the exact build-pinned origin and reject missing or
cross-origin evidence; do not add preview-wide trusted-origin wildcards.

Signup/login/recovery may run before active membership exists. They must apply
their own explicit admission, origin/CSRF and input policy rather than blindly
requiring active membership or weakening the protected-write guard. Authentication
cookie persistence and response headers stay with the owning flow. VOLO-117 adds
no auth forms, hosted email, callbacks, account writes or redirect activation.

### Login destination agreed for VOLO-116 / VOLO-22

Signed-out protected-page visitors go to the fixed same-origin `/login` path,
with fixed `?reason=authentication-required`, without a `next` parameter or
forwarded query/token. The fixed query suppresses Netlify's automatic incoming
query propagation and must remain when VOLO-22 replaces the placeholder.
VOLO-154 replaces VOLO-116's placeholder with an accessible email/password form
and home link while preserving this public destination.
Missing/disabled membership shows an access-denied state on the protected page,
not a login loop. No hosted callback setting is activated by this route contract.

`POST /auth/login` accepts only a bounded native email/password form, rejects
missing/foreign Origin and cross-site fetch evidence before Auth, and uses the
existing writable Supabase SSR client. Email whitespace is trimmed; passwords
are never normalized. Invalid credentials, unconfirmed/blocked accounts and
provider failures produce fixed safe feedback without echoing provider details
or form values. An Auth outage never automatically retries the password request.
Cookies and all responses use private/no-store policy. Login query input is
canonicalized before rendering, with no arbitrary `next` destination.

Successful login returns a native 303 to `/dashboard`, making a fresh document
request rather than retaining a client navigation decision. The dashboard still
verifies current active membership; login creates no membership or setup authority.
Missing/disabled membership remains denied. The form clears retained fields on
page restoration. VOLO-155 adds native `POST /auth/logout` to app navigation. It
checks the exact configured Origin and fetch-site evidence before Auth, rejects
query destinations, and uses SDK `signOut({scope: 'local'})`. It requires no
active membership. All responses are private/no-store. Auth/session chunks, PKCE
verifier and invitation setup/confirmation cookies are cleared even if provider
sign-out cannot be confirmed; unrelated cookies and independent sessions remain.
Success uses a fixed 303 to `/login?result=signed_out`; uncertainty uses fixed
`logout_unavailable` feedback. Protected document restoration hides historical
content and reloads to recheck current cookies. Logout revokes current refresh
authority when Auth confirms it; already-issued access JWTs may remain valid until
expiry. Broader cross-feature navigation is VOLO-25; hosted account tests and
release evidence remain VOLO-110.

### Invitation and recovery callback

VOLO-156 adds public `/forgot-password`, linked from login, and native
`POST /auth/recovery`. The handler checks the exact configured Origin and
fetch-site evidence, rejects query destinations, and accepts one bounded email
field before contacting Auth. A stateless public client requests mail without
reading, refreshing or changing visitor cookies. Existing/unknown accounts,
provider rejection, rate limits and outages receive the same fixed acknowledgment;
provider calls are bounded and never automatically retried. Responses and the
request page use private/no-store and no-referrer policy.

Ordinary recovery supplies the fixed `/auth/confirm?flow=recovery` callback.
The local template appends `token_hash` and `type=recovery`, with no invitation
`resume` proof. Its neutral wording also supports invitation renewal. The marker
grants no authority: VOLO-157 verifies the provider token on an explicit POST
and creates separate password recovery authorization. Hosted SMTP, templates and exact
redirect allowlists remain separate VOLO-107/110 work.

VOLO-121's approved [invitation activation contract](superpowers/specs/2026-10-07-volo-121-invitation-contract-design.md)
defines the invitation branch. Invitations target one specific email address and
do not expire with age: they remain eligible until redeemed, revoked or
superseded. Provider verification links and setup authorization still expire;
an admin resend can renew the link for the same eligible invitation. MVP sending
is active-admin-only. Member invitations are future work, with issuer permissions
kept separate from the recipient's member role.

The implemented `/auth/confirm` GET/HEAD does not verify or consume the invitation.
An explicit origin/CSRF-checked acceptance POST verifies the recorded provider type, persists
session cookies and creates server-owned setup authorization bound to the user,
session and invitation version. Token transport stays in short-lived secret
server state behind an opaque cookie; it must not appear in rendered HTML/RSC or
subsequent redirects. After verification, use fixed `/account/setup`.
General login/recovery sessions do not grant invitation setup authority.

The server-observed password step precedes a single database transaction that
activates member membership and redeems the invitation. Existing or disabled
memberships are not reset or re-enabled by acceptance. Provider operations and
cookie delivery are outside that transaction; ambiguity leaves access denied
and follows the documented reconciliation/retry path. Ordinary recovery stays separate. An invitation resend for a confirmed bound
subject may use `type=recovery` only with the current invitation-specific proof
described below. Ordinary recovery is implemented separately; hosted acceptance
verification remains separate work.

Invitation and recovery emails must land at the approved origin's
`/auth/confirm`. The auth implementation must coordinate its `redirectTo`,
email templates, and token verification so the path is added exactly once.
For server-side email verification, the handler validates the token hash and
expected invitation/recovery type using a request-scoped Supabase client and
establishes session cookies before redirecting to that flow's fixed same-origin
password page. Query parameters carry verification data, not a new destination
to trust. Missing, expired, reused, or invalid tokens must fail safely.

Do not accept a free-form absolute `next`/return URL. Prefer fixed destinations
chosen by the verified flow. If a return path is necessary, restrict it to an
explicit set of same-origin application paths and reject protocol-relative,
encoded, credential-bearing, and external URL forms. Choose the permitted origin
from reviewed deployment configuration, not an unchecked Host or forwarded-host
header. Never put tokens in logs, Jira, screenshots, or redirect destinations
after verification. Session-bearing responses require private/no-store behavior.

The Supabase allowlist and application redirect validation are separate controls.
An unapproved Supabase `redirectTo` can fall back to the Site URL; do not assume
the provider returns an error. Verify that it never sends authentication data
to the requested unapproved destination, and that the app rejects its own
unapproved return destinations.

## Activation and verification

1. Implement and test the callback/session flows locally under VOLO-21/23/24.
   Update local `additional_redirect_urls` to the two exact local callbacks;
   test using local Auth and the local mail viewer with disposable accounts.
2. Deploy a reviewed auth PR and confirm its exact numbered preview URL and
   revision. Review hosted email templates and SMTP before sending any real
   invitation or reset. Add only that preview's exact callback URL for testing.
   Treat a hosted redirect addition as security-sensitive: obtain approval for
   the exact destination immediately before saving it.
3. Exercise valid invitation and recovery links, password establishment/change,
   and server-visible session cookies. Test missing, expired, reused and tampered
   tokens. Verify unlisted origins and lookalike preview hosts receive no tokens,
   including Site URL fallback behavior. Check rejected return paths and headers,
   query strings, HTML, RSC and caching for unintended credential exposure.
4. Run writes against local/disposable data. Hosted end-to-end tests need an
   explicitly approved test account, recipient and bounded writes because this
   backend is shared. Do not reset, seed, or create real users as a smoke check.
5. Coordinate the exact production callback entry with the explicitly requested
   production auth release. Keep Netlify auto-publishing locked; a merge does
   not publish the handler. Verify production after release, then retire the
   preview entry. Record settings, commit/deploy IDs, dates and pass/fail evidence
   without recording email links or tokens. Supply these results to VOLO-110.

## References

- [Supabase redirect URLs and Site URL](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase request-scoped SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs)
- [Environment context and fork policy](environment-configuration.md#netlify-and-ci)
- [Release workflow](release-workflow.md)

## Session response caching handoff (VOLO-118)

VOLO-21/22/23 and future invitation/reset callbacks must apply
`applyPrivateResponseHeaders` from `lib/http/private-response.ts` to every
session/token-bearing response, success or failure, including before membership
exists. Writable SDK clients apply it through the existing header sink before
cookie persistence. Preserve cookie/redirect ownership. Login/logout must also
invalidate retained Router Cache state and perform fresh session-change navigation
using supported installed Next APIs. HTTP policy cannot erase already-delivered
history. See the [cache contract](private-caching.md); VOLO-110 retains hosted
authenticated session/callback/CDN verification with an explicitly approved account.

## Initial invitation issuance (VOLO-148)

The server-only issuance policy requires a fresh active admin and reserves a
durable initial send before calling Auth. It creates a new unconfirmed subject
with the reserved operation UUID, durably binds it, then sends the invitation.
Existing confirmed/unconfirmed accounts are rejected; issuance creates no
membership and never resets or re-enables accounts. Accepted means provider
acceptance, not delivery. Started/unknown attempts block another send until
VOLO-149 reconciliation.

The checked-in **local** invite template links directly to the exact application
`/auth/confirm?flow=invitation&token_hash=…&type=invite` using the server-pinned origin. The local
harness captures mail and explicitly accepts the link in its owned local app;
GET/HEAD do not consume the token or establish a session. Application
invitations have no age-based expiry, while provider tokens remain finite.

Hosted enablement still requires separate approval for the matching email template,
exact callback allowlist, server secret and migrations. This change does not install
those settings or make the hosted invitation/confirmation UI available.

## VOLO-149 resend amendment

Initial issuance remains `type=invite`. Resending renews the same bound Auth
subject and increments the invitation version. Unconfirmed subjects receive an
invite; confirmed subjects receive recovery transport without changing their
password, confirmation, ban, membership or role. Both resend links carry a random
32-byte `resume` secret; only its SHA-256 digest and recorded transport persist.
The server’s fixed callback includes `?flow=invitation`, then adds `resume` on
renewal. Local templates append `&token_hash=...&type=...` uniformly; they never
compare origins with the project Site URL. `flow` is a non-authorizing marker and
must never substitute for provider verification or proof. Ordinary recovery
uses the fixed `?flow=recovery` callback and requires no invitation proof.

VOLO-122 verifies the actual provider token and exact subject/email, then
consumes the matching current-generation proof **in the same SQL transaction**
that creates setup authorization. An ordinary recovery session, client-selected
type, absent/reused proof or an old version cannot grant invitation authority.
GET/HEAD must not consume either token or proof. All query secrets require ingress
redaction and short-lived protected transport state before hosted activation.

Inspection never treats account existence, confirmation or timestamps as a send
receipt. Explicit reconciliation requires the exact attempt/version and original
trusted provider response. Losing every trustworthy response leaves the operation
pending and blocks another send; there is no timeout takeover or blind retry.
No hosted templates, allowlists or accounts are changed by this implementation.

The `/admin/invitations` page shows the latest 50 invitations and their
current-generation send state to current active admins only. Lifecycle status is
separate from send acceptance, failure or unresolved outcomes; age does not expire
an invitation and acceptance does not confirm delivery. Queries return minimal
DTOs with private HTML/RSC cache policy. VOLO-151 adds guarded email sending,
provider-link renewal for issued/setup invitations and status checks for uncertain
live sends. Terminal invitations offer no send action. Each form rechecks current
admin membership and origin; generation actions require the displayed version.
An uncertain result never automatically retries or offers another send. These
controls do not provide a browser-selected reconciliation receipt. VOLO-154
supplies login and VOLO-123 supplies recipient setup; authenticated write evidence
uses disposable fixtures. Previews share production and must not be used for
test email writes.

### Implemented invitation acceptance boundary (VOLO-122)

The Node `/auth/confirm` handler now retains a valid invitation email link in
short-lived encrypted server transport, sets an opaque host-only HttpOnly cookie,
and redirects to the fixed clean `/auth/confirm` URL. The clean HTML form contains
only CSRF. GET never calls Auth verification; HEAD and prefetch create no transport
or cookies. The exact route is excluded from Proxy session refresh so scanning a
link cannot refresh or consume a preexisting session.

Explicit same-origin, fetch-metadata and CSRF-checked POST claims transport once,
verifies the retained provider token, verifies claims and a fresh provider user,
and binds the subject/email/session to the current invitation. Current resend
proof consumption and setup authority creation share one locked transaction.
Successful POST persists Auth cookies, sets a distinct opaque setup cookie and
redirects only to `/account/setup`. It grants no membership or admin access.
VOLO-123 supplies the setup page; VOLO-124 supplies password/activation behavior.

Downstream server code calls `getVerifiedInvitationSetup()` from
`lib/auth/invitation-setup.ts`. Its minimal authorized result includes invitation
ID/version, authorization ID and expiry. Each read revalidates Auth and checks the
matching session, subject/email, origin, current version/correlation and database
expiry. A general login, another session, expired grant or ordinary recovery
without the current invitation proof cannot acquire setup authority.

All confirmation responses carry private browser/CDN no-store, no-referrer and
restrictive CSP. Wrong origin or old CSRF cannot consume a newer transport. Once
claimed, failures do not retry provider verification. A later store failure clears
newly issued Auth/setup cookies. If a link was consumed or the outcome is uncertain,
ask an admin to inspect or renew the provider link; do not repeatedly submit the
same form. Missing configuration/service outages produce safe temporary failure.

Hosted activation stays gated on the key/cleanup/ingress-log prerequisites in
[environment configuration](environment-configuration.md). Local disposable CI
is the only environment used for provider/database writes in VOLO-122.

### Implemented account setup handoff (VOLO-123/124/125)

`GET /account/setup` calls `getVerifiedInvitationSetup()` and exposes the native
password form only with fresh, matching setup authority. A signed-out visitor
goes to `/login?reason=authentication-required`; an existing active member goes
to `/dashboard?from=account-setup`. Other denied visitors see “Invitation required”;
an unavailable check offers retry without granting access.

The form posts `password`, `passwordConfirmation` and setup-bound `csrf` to
`POST /account/complete`. Server validation requires matching passwords of at
least eight characters and at most 256 UTF-8 bytes. Origin/CSRF and fresh Auth
checks precede a database reservation. A verified provider password success is
recorded before the transaction activates member membership and redeems the
invitation. Auth and the database are separate operations; there is no claim of
a distributed transaction. Success clears the setup cookie and redirects to
`/dashboard` after a fresh member check. All completion outcomes are private/no-store.

| Setup result | User action / server behavior |
| --- | --- |
| `invalid_input` | Correct the matching password fields; server validation remains authoritative. |
| `password_rejected` | Choose a different password; retry is allowed after a safe reservation release. |
| `retry_later` | Wait and retry; recorded password success resumes redemption without another password update. |
| `renew_invitation` | Ask the inviter to renew; an uncertain provider outcome must not trigger a blind password retry. |
| `access_denied` | Ask the inviter for help; no account activation is authorized. |

Result query values are presentation only. Each retry rechecks current identity,
session, invitation version, eligibility and setup expiry. Confirmation failures
after transport consumption require a current email or admin renewal rather than
repeated verification. Resend retains the same eligible invitation/subject;
invitation age does not expire it. Provider links, ten-minute transport and
30-minute setup authority have independent expiry.

The approved [activation contract](superpowers/specs/2026-10-07-volo-121-invitation-contract-design.md)
and [persistence contract](superpowers/specs/2026-10-07-volo-127-invitation-schema-design.md)
remain authoritative. [VOLO-125 evidence](volo-125-verification.md) and the
[VOLO-126 readiness record](preview-verification.md#volo-126-account-signup-handoff)
separate local/CI acceptance from pending hosted checks.

## VOLO-157 ordinary recovery

An explicit `flow=recovery`, `type=recovery` confirmation accepts no invitation
proof or destination. The encrypted, short-lived confirmation transport preserves
that purpose. GET/HEAD never verify the provider token; the clean confirmation
page contains no token. An origin/CSRF-checked POST verifies the real Auth user
and session, then redirects only to `/reset-password`.

Recovery authorization is separate from invitation setup: an opaque HttpOnly
cookie identifies a digest-only, 30-minute database grant bound to the verified
user, normalized email, Auth session and exact origin. A fresh verified email
replaces the user's previous grant. Active account bans deny recovery; retained
timestamps from elapsed temporary bans do not. Recovery creates no membership,
role, invitation redemption or admission authority. The service-only RPCs validate
all bindings, and a five-minute cleanup job erases expired grants.

The native reset form requires matching passwords and domain-separated CSRF.
`POST /auth/reset-password` validates origin and bounded input, re-verifies the
current Auth identity, and atomically consumes the grant before one bounded
provider password update. Concurrent requests and replay cannot authorize a
second update. Invalid input can be corrected before consumption. After provider
rejection or an uncertain response, request a new email; a password whose
committed response was lost may already work for sign-in. Never automatically
retry the password write.

Success attempts bounded current-session sign-out, clears browser Auth and
confirmation/setup/recovery cookies even when revocation is unavailable, and
redirects to `/login?result=password_reset` for fresh sign-in. Reset pages and
responses are private/no-store and no-referrer; only fixed safe feedback is
accepted. Logout also clears recovery authority. Hosted schema/template settings,
Deploy Preview acceptance and production release must be verified separately.
