# Auth callback contract

VOLO-107 uses exact callback URLs for local development, production, and
individually reviewed Netlify Deploy Previews. There is no staging environment.
This is the approved configuration plan, not evidence of working authentication.

## Current state

The hosted Supabase URL Configuration was inspected on October 6, 2026:

- Site URL: `https://voloapp.netlify.app`.
- Redirect URLs: empty.
- No changes were made to hosted Auth settings.

The app has typed Supabase SDK clients and Proxy session refresh. It has no
invitation/reset callback or completed user-facing authentication flow.
VOLO-21 supplies invitation-gated account establishment, VOLO-23 supplies reset
flows and hosted mail delivery, and VOLO-24 supplies request-scoped session
handling. Those tickets block VOLO-107's end-to-end verification. VOLO-107 stays
In Progress until configuration and valid/invalid redirect tests are complete;
its documentation PR alone does not complete the ticket or VOLO-110.

Local `supabase/config.toml` currently uses Site URL `http://127.0.0.1:3000`
and additional redirect `http://localhost:3000`. It has not yet been changed to
the callback contract below. Local configuration does not update hosted Auth.

## Exact destinations to configure when the route exists

| Auth service | Application | Required callback entry | Status |
| --- | --- | --- | --- |
| Local Supabase | Local app on localhost | `http://localhost:3000/auth/confirm` | Pending implementation and local config update |
| Local Supabase | Local app on loopback IP | `http://127.0.0.1:3000/auth/confirm` | Pending implementation and local config update |
| Hosted Supabase | Production | `https://voloapp.netlify.app/auth/confirm` | Pending route release and hosted configuration |
| Hosted Supabase | One approved PR preview | `https://deploy-preview-<PR-number>--voloapp.netlify.app/auth/confirm` | Pattern for an exact entry; replace with a reviewed PR number before adding |

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
VOLO-116 provides a public
“Sign-in is not available yet” placeholder with a home link. VOLO-22 replaces
that body with login/logout behavior; it must preserve the public destination.
Missing/disabled membership shows an access-denied state on the protected page,
not a login loop. No hosted callback setting is activated by this route contract.

### Invitation and recovery callback

VOLO-121's approved [invitation activation contract](superpowers/specs/2026-10-07-volo-121-invitation-contract-design.md)
defines the invitation branch. Invitations target one specific email address and
do not expire with age: they remain eligible until redeemed, revoked or
superseded. Provider verification links and setup authorization still expire;
an admin resend can renew the link for the same eligible invitation. MVP sending
is active-admin-only. Member invitations are future work, with issuer permissions
kept separate from the recipient's member role.

The planned `/auth/confirm` GET/HEAD does not verify or consume the invitation.
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
described below. These are implementation requirements for
VOLO-122/124/27/28/29/30, not evidence that those flows currently exist.

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
`/auth/confirm?token_hash=…&type=invite` using the server-pinned origin. The local
harness captures mail without fetching the link. VOLO-122 will implement explicit
acceptance; GET/HEAD must not consume the token or establish a session. Application
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
Local templates preserve that query alongside `token_hash` and `type`.

VOLO-122 must verify the actual provider token and exact subject/email, then
consume the matching current-generation proof **in the same SQL transaction**
that creates setup authorization. This ticket supplies the consumption primitive,
not a public callback or setup route. An ordinary recovery session, client-selected
type, absent/reused proof or an old version cannot grant invitation authority.
GET/HEAD must not consume either token or proof. All query secrets require ingress
redaction and short-lived protected transport state before hosted activation.

Inspection never treats account existence, confirmation or timestamps as a send
receipt. Explicit reconciliation requires the exact attempt/version and original
trusted provider response. Losing every trustworthy response leaves the operation
pending and blocks another send; there is no timeout takeover or blind retry.
No hosted templates, allowlists or accounts are changed by this implementation.
