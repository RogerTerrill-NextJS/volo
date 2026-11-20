# VOLO-244: Move VOLO hosting to Vercel

Status: approved by user November 19, 2026. VOLO-244 is In Progress. Destination
is existing `VOLO / volo` (`volo7/volo`). Hosting preparation is recorded separately
in `docs/volo-244-verification.md`; database, Auth, DNS and production release
changes remain outside the completed preparation.

## Outcome and release model

Run the existing Next.js application on Vercel with automatic PR previews and
manual production promotion from reviewed `main` builds. Keep the existing
Supabase project and Netlify production available throughout migration. There
is no separate staging environment or database.

Recommended approach: disable Vercel's **Auto-assign Custom Production Domains**
setting in Production / Branch Tracking. `main` builds remain reviewable before
manual promotion; feature branches retain automatic previews. Verify the actual
destination account's controls and default project-domain behavior before
connecting production domains. A staged build is an unpublished artifact, not a
new staging environment. Netlify production auto-publishing remains locked.

Alternative: disable Git-triggered deployments for `main` using
`git.deploymentEnabled`, retaining previews on other branches, then build the
exact approved SHA manually for each release. This adds manual build work and is
the fallback if the destination cannot provide the recommended release control.
Automatic publication on merge would change the agreed release policy and is
not proposed.

## Findings from the existing app

- Starting source: merged PR #124, main SHA
  `3e2a480f22311704fe1e2244eb6391037f6641de`.
- Next.js 16.3.8, React 19.2.8, Node.js 24; ordinary server output with Proxy,
  Server Actions, route handlers, Sharp image processing and Supabase SSR.
  No repository Netlify adapter, functions directory or `netlify.toml` needs
  conversion. Keep `npm ci` and `npm run build`; use native Next.js detection.
- `lib/auth/mutation-origin.mjs` recognizes Netlify contexts only. Its result is
  frozen in `next.config.ts` and used for login/logout, protected mutations,
  invitation links, setup cookies and password recovery. This is a security
  boundary, not merely a URL display setting.
- `lib/http/private-response.ts` sets browser, generic CDN and Netlify cache
  policy; `/sw.js` has separate no-store configuration in `next.config.ts`.
  Vercel-specific policy and hosted cache evidence need coverage.
- Existing callback policy uses exact reviewed preview URLs. Do not substitute
  `*.vercel.app` or a team-wide wildcard.
- Existing public deployment documentation includes historical statements about
  optional privileged credentials. Audit actual invitation/admin runtime needs
  before provisioning; do not blindly copy every local or Netlify variable.
- GitHub CI does not deploy the database. Its three application validation jobs
  remain required; hosting status-check names need review after Vercel is linked.

## Application changes

1. Extend trusted build metadata resolution for Vercel, preserving Netlify
   behavior during overlap. Preview origin comes from verified deployment
   metadata; production uses one explicitly configured HTTPS canonical origin.
   Fail the build on missing/malformed hosted metadata, unsupported environments
   or ambiguous providers. Never derive mutation trust from incoming headers,
   a request URL, arbitrary redirect parameters or wildcard hosts.
2. Choose one canonical preview origin after observing the generated deployment
   and branch URLs in the destination project. Test both ways reviewers can
   enter the preview. An alias must lead to the canonical app before forms are
   used; it must not silently become a second trusted mutation origin or forward
   credentials/tokens to another hostname. Keep exact preview callback entries
   tied to the reviewed revision and retire them when superseded.
3. Apply `Vercel-CDN-Cache-Control: no-store` to the shared private-response
   policy and service worker, while retaining generic and Netlify headers.
   Verify Vercel's cache status and private response isolation on the actual
   deployment; Vercel may consume its targeted header before sending responses
   to the browser, so a missing client-visible targeted header alone is not a
   failed no-store assertion. Public static assets should retain normal caching.
4. Update environment, callback, preview/cache and release documentation with
   Vercel instructions and separately dated Netlify rollback instructions.
   Do not rewrite historical Netlify evidence as Vercel evidence. Reconcile
   `AGENTS.md` with the final reviewed workflow without overwriting existing
   unrelated edits.

## Hosting and backend configuration

- Destination Vercel account/team/project requires user identification. The
  dashboard currently shows the login screen. Confirm the account's existing
  plan, limits, repository access and preview protection; any new paid plan or
  broader GitHub access needs its own explicit decision.
- Use Node.js 24, repository root, Next.js preset and framework defaults for
  output. Expose trusted Vercel system build metadata. Verify these settings in
  a real build rather than assuming the dashboard defaults.
- Scope `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the intended Preview and Production
  builds. Inventory server runtime requirements, including
  `VOLO_CONFIRMATION_KEYS` and any actually required `SUPABASE_SECRET_KEY`.
  Transfer necessary secrets through an approved private mechanism; never print
  values, commit them, put them in a ticket, or expose them through Next config
  `env`. CLI access tokens and database passwords are not web runtime variables.
- Keep Supabase Auth, Postgres, Storage, Realtime, policies and cron jobs in the
  existing project. No schema/data migration is required solely for this hosting
  move. Check existing backend compatibility and cron health; do not reapply or
  reset hosted migrations as part of frontend deployment.
- Preserve the current Supabase Site URL until the release operation. Add only
  reviewed exact callback URLs under the existing hosted-configuration approval
  process. Check invitation/recovery templates, callback paths, origin-derived
  links, cookie behavior and token/query logging protections before email-link
  activation. Retain old destinations for the agreed overlap period.
- `voloapp.netlify.app` cannot be transferred as a Vercel domain. Select a new
  Vercel address or a user-owned custom domain before production configuration.
  A hostname change requires fresh login and checking existing browser/PWA
  sessions and links. DNS/TLS changes belong to the requested release.

## Verification and completion

Application preparation: targeted origin tests (including invalid metadata and
host spoofing), private-header replacement tests, mutation HTTP/Server Action
checks, Proxy/session and private-cache regression checks, typecheck, lint and
production build. Keep fixtures isolated from hosted data. Run broader critical
workflow checks because origin/cache policy is shared.

Hosted preview: record exact SHA, deployment URL and canonical review URL; check
home/login, health, protected-route denial, direct navigation/refresh, admin
member names, certificates/ratings, profile photos, directory, flight flows and
messaging. Verify signed-in/session behavior using approved accounts. Perform
mutation tests locally/disposably; any necessary hosted writes must have bounded
authorization. Health alone is not application verification. Record pending
email/callback tests honestly if they are not activated.

Release: run the full suite for the selected release SHA; identify the current
Netlify published deploy, retained rollback artifact and backend compatibility.
Record reviewed Vercel production artifact/configuration and release controls.
Only a user-requested release authorizes promotion, Auth Site URL and DNS/domain
cutover. Verify production separately, including a fresh browser and an existing
PWA session. For the first Vercel release, cross-provider rollback relies on the
retained Netlify deployment and old URL/domain route; do not assume an earlier
Vercel production artifact exists.

VOLO-244 remains In Progress until production cutover and the agreed rollback
checkpoint are verified. VOLO-245 handles later Netlify archival; neither old
Netlify project is deleted or disconnected during this preparation.

## Decisions pending

1. Destination Vercel account/team/project and access.
2. Approval of the recommended manual-promotion release approach above.
3. New production hostname and how long old Netlify links must remain usable.
4. Observed canonical preview URL behavior and exact hosted callback scope.

## References

- [Vercel manual promotion and production branch controls](https://vercel.com/docs/deployments/promoting-a-deployment)
- [Vercel Git deployment configuration](https://vercel.com/docs/project-configuration/git-configuration)
- [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables)
- [Vercel generated deployment URLs](https://vercel.com/docs/deployments/generated-urls)
- [Vercel CDN cache headers](https://vercel.com/docs/caching/cache-control-headers)
- [Existing release procedure](../../release-workflow.md)
- [Existing exact callback contract](../../auth-callbacks.md)

Installed Next.js deployment, Next config `env`, headers and Server Actions
documentation was consulted for this audit. Next config `env` values are bundled;
only the non-secret canonical origin belongs there.
