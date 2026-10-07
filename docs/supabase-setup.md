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
is accepted from user-editable metadata. Profile, invitation, flight, messaging and
moderation tables follow in their feature tickets after the open design decisions.

Members can read only their own membership, including disabled status. Browser clients
cannot insert, update or delete memberships, even when the application role is `admin`.
The service role has explicit write privileges. Admin overviews and operations belong
in guarded server code: verify the caller through Supabase Auth, then read their current
membership using their session and require **both** `status = active` and `role = admin`
before using a privileged client. Missing membership denies access. Future protected
table policies must check current active membership, so disabling invalidates access
even with an existing JWT. This migration does not yet implement application auth guards.

Membership foreign keys restrict Auth user deletion until retention is agreed.
Storage and Realtime services are enabled locally, but there are no buckets or published
application tables yet. Add private buckets, object policies and Realtime publications
with the feature that needs them; do not publish role data.

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
or identities; they are database fixtures, not working login accounts. Use local
Auth invitations and the local mail viewer for sign-in testing.

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

Both contexts rebuilt successfully. Hosted page/navigation checks passed, but the
application does not yet consume these variables through a Supabase client. Auth,
database connections, and feature flows need verification when implemented.

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
