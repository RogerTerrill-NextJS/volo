# VOLO-150: Read-only invitation administration

## Approved intent and scope

Give active admins a small, accurate invitation list using the existing server
access and invitation boundaries. VOLO-150 implements authorized queries and
status presentation; VOLO-151 owns send/resend controls. VOLO-29 is merged and
Done. No new invitation lifecycle behavior is introduced.

Add `/admin/invitations` under the protected application group and an admin-only
navigation link. Show the latest 50 invitations, newest creation first with an
ID tie-breaker. Fetch at most 51 rows to determine whether older rows are omitted;
state the limit visibly. No filtering, search, pagination, detail/history screen,
role selection, mutation controls, or general dashboard in this ticket.

## Authorization and data

A server-only query boundary verifies the current session and active admin
membership using the existing access service before reading invitation data.
Do not accept a requester ID, role, or authorization decision from the browser.
Check access again before returning private results; permission loss or lookup
failure must not return invitation rows. Reuse existing access error presentation.
Signed-out requests redirect to the existing fixed `/login` destination; members
and disabled admins receive access denied. Access/database failures display an
unavailable state without provider error bodies or a misleading empty list.

Use the existing server secret and table SELECT permissions; no browser grants,
RLS changes, migration, RPC, or new public API. Reuse the existing bounded,
no-store Supabase transport rather than creating another client framework.
Select only invitation ID, version, recipient email, status, created/updated
timestamps and current-generation send outcome/resolution. Obtain invitation and
attempt information in one database statement so a concurrent renewal cannot
combine generations. A bounded nested latest-attempt selection may be used;
only an attempt whose version matches the invitation can supply send state.

Return an explicit minimal DTO. Validate row shapes and known enums; malformed
data fails closed. Never select or return Auth subject IDs, inviter/requester IDs,
setup authorization, proof digests, tokens, raw provider errors, or attempt history.
The recipient email is private admin information and must not enter logs.

## Presentation

Use the existing app shell and styling with a simple accessible table (or compact
rows on narrow screens), recipient email, invitation status, send state and last
update. Include clear empty and unavailable states. IDs/version are internal DTO
fields for stable rendering and later controls, not displayed administration data.

Invitation labels preserve lifecycle independently of sending:

| Stored status | Display |
| --- | --- |
| pending_issuance | Pending |
| issued | Awaiting signup |
| setup_verified / password_established | Setup in progress |
| redeemed | Redeemed |
| revoked | Revoked |
| superseded | Superseded |

Send labels use the current attempt's reconciliation result when present,
otherwise its original outcome: accepted → Accepted for sending; rejected →
Send failed; started/unknown → Needs review; no current attempt → Not sent.
An unknown send never overrides a terminal invitation status or becomes a retry
recommendation. Accepted does not claim delivery. Age never expires application
invitations; this list makes no provider-token expiry claim.

## Cache and security checks

Extend the existing protected-path cache classification to `/admin` and its
descendants. Keep the page dynamic, all data reads uncached, app link prefetch
disabled, and existing private browser/CDN headers on HTML, RSC, redirects and
denials. Authorization remains at the query boundary, independently of layout or
navigation visibility. Render emails as escaped text, with no raw HTML.

Reuse existing fixtures and CI jobs. Add focused tests for admin/non-admin access,
permission loss and lookup failure, the status mapping (including reconciled and
terminal/unknown combinations), current-generation selection, bounded ordering,
minimal projection/DTO, empty/error distinction and private response policy.
Extend the existing compiled app fixture for HTML/RSC access and sensitive-field
exclusion. Use disposable local/CI data for any writes; never write through a
preview sharing production Supabase. Do not repeat provider email tests for this
read-only feature or create a second harness. Required typecheck, lint, build,
repository and relevant boundary checks must pass before handoff.

## Execution constraints and completion

Use `feature/volo-150-invitation-admin-queries` based on merged main, in the
existing checkout. Preserve untracked `docs/audits/`. Read the relevant installed
Next guides before application changes. Preserve inline implementation and one
fresh whole-branch review. No new dependency, hosted migration/account/email/Auth
setting change, staging environment, or production publication. Keep VOLO-150
In Progress until the resulting PR is merged.

Scope check: this is one read-only view over existing tables. Mutation UX and
hosted invitation enablement remain separate. No unresolved product choice is
required for the approved latest-50 presentation.
