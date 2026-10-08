# VOLO-17 — Supabase foundation

## Environment inventory

| Environment | Project | Status |
| --- | --- | --- |
| Local | `volo` (`supabase/config.toml`) | Requires Docker-compatible container runtime |
| Production | `macrktxywcqauxqkbnqb` | Volo project; confirmed healthy October 6, 2026 |
| Netlify Deploy Previews | Same hosted project as production | Separate frontend deployments; shared database |
| Separate staging | Not used | Deploy Previews provide pre-release review |

Production URL: https://macrktxywcqauxqkbnqb.supabase.co.
Production application URL: https://voloapp.netlify.app/.
Preview URLs are linked from each pull request, for example
https://deploy-preview-4--voloapp.netlify.app/.
Project identifiers and publishable keys are public; database passwords, personal access
tokens and Supabase secret/service-role keys are credentials.

Hosted inventory confirmed in VOLO-99 on October 6, 2026:

- Organization: Outside The Cockpit (`crzmvguxusepvtgdvwjp`); project: Volo,
  main/Production, Free plan, Oregon (`us-west-2`).
- Database public schema was empty, with no recorded application migrations.
  Merged SQL and passing local CI do not establish hosted schema deployment.
- Email authentication enabled; public signup and anonymous sign-in disabled;
  email confirmation required. Manual account linking disabled.
- Auth Site URL: `https://voloapp.netlify.app`. Redirect allowlist empty; add exact
  callback URLs when the application implements its invitation/login callbacks.
  See the [VOLO-107 callback contract](auth-callbacks.md) for the approved exact
  destinations, preview review lifecycle, and pending verification dependencies.
- Storage available, with no file buckets. Realtime enabled, public channels allowed,
  and `supabase_realtime` publication contains zero tables. No application table
  changes are streamed; review channel authorization when implementing realtime features.

These are dated observations, not a live health monitor. Recheck before production changes.

## Scope

The first migration creates only `memberships`, matching VOLO-13's server-owned
`member`/`admin` roles and `active`/`disabled` status. All Auth accounts start without
application admission. No Auth trigger automatically creates memberships, and no role
is accepted from user-editable metadata. Invitation persistence is documented below.
Profile, flight, messaging and moderation tables follow in their feature tickets.

Members can read only their own membership, including disabled status. Browser clients
cannot insert, update or delete memberships, even when the application role is `admin`.
The service role has explicit write privileges. Admin overviews and operations belong
in guarded server code: verify the caller through Supabase Auth, then read their current
membership using their session and require **both** `status = active` and `role = admin`
before using a privileged client. Missing membership denies access. Future protected
table policies must check current active membership, so disabling invalidates access
even with an existing JWT. Application identity/current-membership guards now live
in `lib/auth/access.ts`; see [session integration and auth handoff](session-integration.md).

Membership foreign keys restrict Auth user deletion until retention is agreed.
Storage and Realtime services are enabled locally, but there are no buckets or published
application tables yet. Add private buckets, object policies and Realtime publications
with the feature that needs them; do not publish role data.

## Invitation persistence handoff

VOLO-128 delivered the PostgreSQL 17 invitation schema in
[`20261008010000_create_invitations.sql`](../supabase/migrations/20261008010000_create_invitations.sql).
VOLO-130 added
[`20261008020000_validate_revocation_reason_whitespace.sql`](../supabase/migrations/20261008020000_validate_revocation_reason_whitespace.sql)
without rewriting that migration. The approved
[activation contract](superpowers/specs/2026-10-07-volo-121-invitation-contract-design.md)
and [schema/interface contract](superpowers/specs/2026-10-07-volo-127-invitation-schema-design.md)
remain authoritative for consuming features; persistence alone is not a working
invitation/signup flow. This handoff records checked-in schema and disposable CI
behavior, not deployment to the shared hosted database.

### Current snapshot and send history

| Table | Stores | Does not establish |
| --- | --- | --- |
| `public.invitations` | Current email-specific invitation, generation (`version`), bound Auth subject, setup/password snapshot and terminal outcome | Historical transition authority, a verified Auth session, or membership admission |
| `public.invitation_send_attempts` | One durable provider operation per `(invitation_id, invitation_version)`, requester, first safe outcome and later reconciliation | Current eligibility, email delivery, or a full history of setup/password changes |

Application invitations never expire with age. Only redemption, revocation or
supersession ends eligibility; provider links and separate setup authorizations
expire. Pending or uncertain provider/setup state remains denied. The generated
ASCII email key folds case and preserves dots and plus suffixes. Database input
checks require trimmed ASCII addresses of 1–254 bytes; application syntax and real
provider matching remain VOLO-29/125 responsibilities.

Both tables have RLS enabled and no direct privileges for `anon` or
`authenticated`, including browser sessions belonging to admins. `service_role`
has SELECT/INSERT/UPDATE only, with USAGE on the four invitation enums. Privileged
access is not caller authorization: issuance/resend must first verify the caller's
current active admin membership. Member invitations remain future work; recipients
activate as members only. No business RPC, admission trigger or Realtime publication
is supplied by this schema.

Revocation reasons require 1–500 characters with no surrounding ASCII whitespace.
The corrective migration fails atomically on invalid history rather than rewriting
it. Attempt errors allow only timeout, provider_rejected, rate_limited,
provider_unavailable, identity_conflict and unknown. Neither table may contain raw
provider errors, passwords, reusable tokens or session credentials.

### Downstream server operations

These names describe the existing approved semantic contract. The eligibility
read below is implemented; the other operations remain downstream work. None is
a publicly callable RPC. Exact inputs/results are in the
[persistence interface table](superpowers/specs/2026-10-07-volo-127-invitation-schema-design.md#persistence-interface-contract).
Identity, requester role, verified email and setup evidence must come from trusted
server checks, never request fields or a caller-supplied snapshot.

VOLO-146 implements `readInvitationEligibility` in
[`lib/auth/invitation-eligibility.ts`](../lib/auth/invitation-eligibility.ts).
It accepts an invitation ID, positive safe-integer expected version and
server-verified Auth subject/email, returning only `eligible`, `not_eligible` or
`unavailable`. Each call performs a fresh privileged read with a five-second
deadline covering headers and body, no redirects, no retries and no caching.
The server secret is read lazily through the existing configuration boundary.
No invitation rows or credentials are returned. The read does not validate
provider tokens, session/setup expiry or password completion; VOLO-122/124 must
validate those separately, and VOLO-30 must recheck eligibility under its lock.
It grants no membership. `npm run test:access:unit` includes its focused policy
and HTTP failure regressions using fictional responses and a loopback server.

| Consumer | Operation | Required persistence boundary |
| --- | --- | --- |
| VOLO-28 | `readInvitationEligibility` | Check current invitation/version, verified subject/email and eligible state; distinguish denial from service failure; never reject for age alone |
| VOLO-29 | `reserveInvitationSend` | Lock/check eligibility and expected resend version; reserve operation ID and one attempt per generation, then commit before the provider call |
| VOLO-29 | `recordInvitationSendOutcome` | Use captured attempt/version to record a safe outcome; reconcile started/unknown before retry; stale results may update history but cannot advance current state |
| VOLO-122 | `recordVerifiedSetup` | Require provider/session validation for the current bound subject/version; correlate separate expiring, session-bound setup authority |
| VOLO-124 | `recordPasswordEstablished` | Record server-observed password success for the current subject/version and valid setup authorization; do not grant membership |
| VOLO-30 | `redeemInvitation` | Lock/check invitation and current setup authority; create member membership and record redemption atomically; never overwrite or reactivate an existing membership |

Resend advances `version`, retains the bound subject, clears the setup/password
snapshot and invalidates old setup authority. Fence later writes with the captured
version; terminal rows never reopen. Repeated operation IDs reuse identical outcomes
and reject different inputs. Never hold transactions open during Auth/email calls;
multi-row changes require one transaction rather than separate REST writes.

`setup_authorization_id` is correlation only. VOLO-122 owns separate expiring,
session-bound setup authority and encrypted confirmation transport. Row validity
does not prove Auth or transition authority; the consuming flows enforce it and
VOLO-125 verifies real-provider behavior. `getAccess()` remains the app access gate.

Auth, parent-invitation and supersession references use ON DELETE RESTRICT.
Follow the approved contract's explicit owned-fixture cleanup order; never cascade
away audit data or use hosted data for tests. VOLO-91 must resolve account erasure
and retention; these references do not approve indefinite PII retention.

### Generated types and verified evidence

[`lib/supabase/database.types.ts`](../lib/supabase/database.types.ts) is unchanged
pinned CLI output already delivered by VOLO-128. Consumers can use the generated
`Tables<'invitations'>`, `Tables<'invitation_send_attempts'>`, `TablesInsert`,
`TablesUpdate` and `Enums` helpers. `recipient_email_key` is generated and cannot
be supplied on insert/update. These types describe database rows and nullable
fields, not authorized transitions or validated setup state; generated update
shapes do not make identity/email changes permissible. Public `Functions` is empty.

VOLO-130's schema change only affected a CHECK constraint, so regeneration is
unnecessary. After [PR #24](https://github.com/RogerTerrill-NextJS/volo/pull/24)
merged at `3ee1a4b8ffafee76ed794f515b340fbcf7719185`, main's
[database CI](https://github.com/RogerTerrill-NextJS/volo/actions/runs/37809551484/job/113422534730)
passed the committed-type drift check. For later schema changes, use the existing
pinned `db:types`/`db:types:check` commands and artifact workflow below; never
manually edit generated types or add an interface framework.

[VOLO-129's access review](https://outsidethecockpit.atlassian.net/browse/VOLO-129)
confirmed the shipped least-privilege boundary using source review and
[post-merge CI](https://github.com/RogerTerrill-NextJS/volo/actions/runs/37794789433).
[VOLO-130](https://outsidethecockpit.atlassian.net/browse/VOLO-130) extended the
existing suite to 150 assertions (136 invitation + 14 membership), passing
[seeded, seedless and upgrade CI](https://github.com/RogerTerrill-NextJS/volo/actions/runs/37807861387/job/113416889405)
with fixture preservation. Its test-first
[red run](https://github.com/RogerTerrill-NextJS/volo/actions/runs/37807317540/job/113414895739)
exposed four accepted invalid whitespace cases before the corrective migration.

The existing CI-only `node scripts/verify-invitation-upgrade.mjs` also proved
concurrent live-email/subject creation: the second session blocked, then failed
with 23505 on the expected index after the first committed. Cleanup and original
Auth/membership preservation passed. It checks its owned PostgreSQL 17 container,
rejects destination arguments and developer/self-hosted execution, and is not a
hosted command. Existing tests retain old valid snapshots, client denial, send
history and restricted deletion; snapshots never admit members.

VOLO-27 can close after this handoff is merged and its remaining gates are verified.
Sending/resend, setup authority, password orchestration, atomic redemption and
real-provider verification remain with the consumers above. No additional build,
Deploy Preview or hosted migration is required to validate this documentation.

## Local development and verification

Use Node 24, `npm ci`, and a running Docker-compatible runtime. The CLI is pinned
in `package-lock.json`; do not install an unpinned global CLI.

```sh
npm run db:start
npm run db:reset
npm run db:test
npm run db:types
npm run db:types:check
```

`db:reset` explicitly targets **local**. It rebuilds from checked-in migrations and
fictional seeds. The seeds use `example.invalid` addresses and create no passwords
or identities; they are database fixtures, not working login accounts. The separate
`npm run test:auth:integration` command provisions confirmed fictional accounts in
its own disposable stack without sending mail; see [its ownership and cleanup](session-integration.md).

The pgTAP suite creates its own fixtures inside a rolled-back transaction and tests
RLS, row isolation, unauthorized admission, self-promotion, reactivation, metadata
spoofing and privileged writes. Run it against local/disposable databases only.
Verify seed independence with:

```sh
npx --no-install supabase db reset --local --no-seed
npm run db:test
npm run db:types:check
```

VOLO-101 verified [main CI run #6](https://github.com/RogerTerrill-NextJS/volo/actions/runs/37547725092/job/112555647563):
both rebuilds succeeded and all 14 membership tests passed after each rebuild.

`db:types` writes actual CLI output to `lib/supabase/database.types.ts` only after
successful introspection. The generated file is committed (VOLO-102, PR #4);
do not substitute handwritten types. `db:types:check` detects missing/stale types.
The database CI job always checks drift and publishes generated types as an artifact.
If Docker is unavailable locally, download the artifact from successful CI for the
intended schema revision, verify its published checksum, commit the unchanged file,
and verify the new PR's drift check passes. VOLO-102 verified this in
[PR #4 CI](https://github.com/RogerTerrill-NextJS/volo/actions/runs/37553182129/job/112573236197).

## Hosted project setup

1. Confirm the project reference and organization above before changing hosted settings.
   VOLO does not use a separate staging project.
2. Retain the production Site URL and configure exact allowed callback URLs when
   the invitation/login flow exists. Keep public signup and anonymous sign-in disabled
   and email confirmation enabled. Hosted Auth settings
   are separate from the local `config.toml`; SQL migrations do not apply them.
3. Verify Database, Auth, Storage and Realtime services are available. Keep buckets
   private and omit application publications until policies exist. Configure production
   SMTP before sending real invitations; local SMTP configuration does not configure
   hosted mail delivery.
4. For local database work, use local Supabase values in ignored `.env.local`.
   Netlify Production and Deploy Previews currently use the hosted project's URL and
   existing public publishable key. Set `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` at **build time** and rebuild after changes.
   Never put credentials in `next.config.ts`'s `env` option or `NEXT_PUBLIC_` values.
5. Authenticate the pinned CLI with `npx --no-install supabase login`. Supply database passwords through
   protected environment settings when needed. Never copy credentials into Jira,
   shell command arguments, committed files or screenshots.

## Netlify configuration and preview checks

VOLO-100 configured both public variables for Production and Deploy Previews only.
Branch deploys, Preview Server & Agent Runners, and Netlify CLI local development
were left empty. The current Netlify plan permits All scopes; only public values were added.
No secret/service-role key, database password, or access token was added to Netlify.
Untrusted fork deploys require approval.

At the October 6 VOLO-100 verification, both contexts rebuilt and hosted navigation
passed before the application consumed the variables through a Supabase client.
Request-scoped clients, Proxy and guards have since been implemented. Their current
evidence and remaining hosted feature checks are listed in [session integration](session-integration.md);
the earlier observation does not prove today's hosted authenticated flows.

A Deploy Preview is not a separate database and is not automatically read-only.
Use local/disposable databases with fictional records for write tests, seeds,
migrations, and resets. Review and bound any preview action that could write to the
shared production backend. Enforce RLS and grants before exposing feature tables;
never supply privileged credentials to previews.

## Production migration procedure

Local/disposable rebuild verification replaces the previous staging rebuild requirement.
Do not run remote reset or permission-test fixtures against production. Inspect the
actual hosted schema and migration history first; if they differ from the dated
inventory, resolve/baseline the differences before applying migrations.

Use the pinned CLI after `npm ci`. Link explicitly to the confirmed production project:

```sh
npx --no-install supabase link --project-ref macrktxywcqauxqkbnqb
npx --no-install supabase migration list --linked
npx --no-install supabase db push --linked --dry-run
```

Confirm the linked reference before **every** remote operation. Review the dry-run
against the same migrations that passed CI, determine recovery/backup readiness,
and obtain the production release decision before applying:

```sh
npx --no-install supabase db push --linked
npx --no-install supabase migration list --linked
```

`db push` omits seeds unless explicitly requested; never request seeds for production.
Record the migration history and post-application verification in the release ticket.
App deployment, local config, and local seeds do not configure hosted services.
These are instructions, not evidence that a production migration was performed.

## Initial administrator bootstrap

First apply and verify the membership migration in the intended environment.
Invite the intended administrator through the Auth dashboard after mail/redirect setup
and verify the actual Auth UUID and confirmed email with the owner. Do not bootstrap
an admin from signup metadata or a public endpoint. In the chosen project's SQL editor,
confirm the environment and review and replace `CONFIRMED_AUTH_USER_UUID` below.
Verify the account belongs to the intended person; email confirmation alone does not
establish their right to be an administrator. Never select a fictional seed account.
This one-time transaction refuses
to run if any admin already exists or the target is unconfirmed/anonymous.

```sql
begin;
lock table public.memberships in share row exclusive mode;
do $$
declare
  target_user uuid := 'CONFIRMED_AUTH_USER_UUID';
begin
  if exists (select 1 from public.memberships where role = 'admin') then
    raise exception 'Admin already exists; use a reviewed admin operation';
  end if;
  if not exists (
    select 1 from auth.users
    where id = target_user and email is not null and email_confirmed_at is not null
      and not coalesce(is_anonymous, false)
  ) then
    raise exception 'Target must be a verified, non-anonymous Auth account';
  end if;
  insert into public.memberships (user_id, role, status)
  values (target_user, 'admin', 'active')
  on conflict (user_id) do update
    set role = 'admin', status = 'active', disabled_at = null, disabled_reason = null;
end $$;
commit;
```

The guard counts every existing admin, including disabled and fictional seeded admins.
For local bootstrap exercises, first use `npx --no-install supabase db reset --local --no-seed` and
create/confirm an account through local Auth; do not remove a real admin to bypass
the guard. Never reset production to prepare bootstrap. The table lock serializes
membership writes during the check/insert, and a failed transaction must be rolled back.
The upsert can promote/reactivate the explicitly verified target when no admin exists;
review that consequence before executing. This procedure is privileged operator SQL,
not a browser-accessible endpoint. Its guards were reviewed against the migration;
VOLO-103 does not execute a real bootstrap or create a real administrator.
Record operator, environment, target UUID and result privately. Future role changes
need guarded admin operations and an audit trail in their feature ticket.

## References

- [Local development workflow](https://supabase.com/docs/guides/local-development/cli-workflows)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Database types](https://supabase.com/docs/guides/api/rest/generating-types)
- [VOLO-17](https://outsidethecockpit.atlassian.net/browse/VOLO-17)
- [VOLO-13 entity proposal](https://outsidethecockpit.atlassian.net/browse/VOLO-13)
