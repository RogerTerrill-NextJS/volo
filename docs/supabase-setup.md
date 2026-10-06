# VOLO-17 — Supabase foundation

## Environment inventory

| Environment | Project | Status |
| --- | --- | --- |
| Local | `volo` (`supabase/config.toml`) | Requires Docker-compatible container runtime |
| Staging | Separate `volo-staging` project | Organization and project reference still needed |
| Production | `macrktxywcqauxqkbnqb` | Supplied by owner; remote configuration and schema not yet inspected |

Production URL: https://macrktxywcqauxqkbnqb.supabase.co.
Staging application URL: https://voloapp.netlify.app/.
The production application's URL is still needed before configuring Auth redirects.
Project identifiers and publishable keys are public; database passwords, personal access
tokens and Supabase secret/service-role keys are credentials.

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
spoofing and privileged writes. Run it against local/disposable staging only.

`db:types` writes actual CLI output to `lib/supabase/database.types.ts` only after
successful introspection. Commit this generated file once a working database is available;
do not substitute handwritten types. `db:types:check` detects missing/stale types.
The database CI job publishes generated types as an artifact and checks drift once
the initial generated file has been committed. Download that artifact if Docker is
unavailable locally, commit it, and rerun CI.

## Hosted project setup

1. Inspect the existing production project and its organization before changing it.
   Create a separate `volo-staging` project in the agreed organization/region. Use a
   unique password stored in the password manager; select a plan with the owner.
   Record both references above and in local environment settings. Production and
   staging must never share credentials or user data.
2. For each project, configure Auth's Site URL and exact allowed callback URLs for
   that environment. Until an invitation flow is implemented, disable public signups
   and anonymous sign-ins. Keep email confirmation enabled. Hosted Auth settings
   are separate from the local `config.toml`; SQL migrations do not apply them.
3. Verify Database, Auth, Storage and Realtime services are available. Keep buckets
   private and omit application publications until policies exist. Configure production
   SMTP before sending real invitations; local SMTP configuration does not configure
   hosted mail delivery.
4. Set the matching URL and publishable key in ignored `.env.local` and Netlify
   environment settings. Staging builds and deploy previews use staging; production
   builds use production. Set `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` at **build time** and rebuild after changes.
   Never put credentials in `next.config.ts`'s `env` option or `NEXT_PUBLIC_` values.
5. Authenticate the CLI with `npx supabase login`. Supply database passwords through
   protected environment settings when needed. Never copy credentials into Jira,
   shell command arguments, committed files or screenshots.

## Apply and rebuild staging

Substitute the confirmed staging reference; the placeholder intentionally cannot be used.

```sh
npx supabase link --project-ref STAGING_PROJECT_REF
npx supabase migration list --linked
npx supabase db push --linked --dry-run
npx supabase db push --linked
```

Confirm the linked reference is staging before **every** remote operation. For a
fresh disposable staging project, the following replays migrations plus fictional
seeds. It destroys the linked project's database contents, so requires the owner's
explicit designation of that staging data as disposable. Auth accounts and Storage
objects need separate lifecycle handling; a database reset is not a project reset.

```sh
npx supabase db reset --linked
npx supabase test db --linked
npx supabase migration list --linked
```

Record the staging reference, migration history, test result, generated-type verification
and hosted service checks in the ticket once performed. Do not claim a staging rebuild
based only on local tests. Never run a remote reset against production.

For production, inspect/baseline any existing schema and migration history first.
Promote the same reviewed migrations with `db push --linked --dry-run` followed by
`db push --linked` after staging passes. `db push` omits seeds unless explicitly requested;
never request seeds for production. Local config/seeds are not production configuration.

## Initial administrator bootstrap

Invite the intended administrator through the Auth dashboard after mail/redirect setup
and verify the actual Auth UUID and confirmed email with the owner. Do not bootstrap
an admin from signup metadata or a public endpoint. In the chosen project's SQL editor,
review and replace `CONFIRMED_AUTH_USER_UUID` below. This one-time transaction refuses
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

Seeded staging has a fictional admin; it is intentionally ineligible for real bootstrap.
Rebuild a disposable staging database with `db reset --linked --no-seed` before
bootstrapping a real administrator, or use a separate empty staging project.
Record operator, environment, target UUID and result privately. Future role changes
need guarded admin operations and an audit trail in their feature ticket.

## References

- [Local development workflow](https://supabase.com/docs/guides/local-development/cli-workflows)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Database types](https://supabase.com/docs/guides/api/rest/generating-types)
- [VOLO-17](https://outsidethecockpit.atlassian.net/browse/VOLO-17)
- [VOLO-13 entity proposal](https://outsidethecockpit.atlassian.net/browse/VOLO-13)
