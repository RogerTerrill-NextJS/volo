# Vercel migration and deployment

VOLO-244 targets the existing [VOLO / volo project](https://vercel.com/volo7/volo),
connected to [RogerTerrill-NextJS/volo](https://github.com/RogerTerrill-NextJS/volo).
The user-authorized production cutover completed on November 20, 2026:
<https://volo-six-woad.vercel.app/> serves `799b154` from completed Production
artifact `ARZWdzryywsfiDJ25aJAb6YyFN7L`. Main CI passed all three jobs; production
login/logout and core page reads passed, and the user confirmed phone checks.
Supabase Site URL now matches the Vercel address. No database migration was needed.
Strict hosted CDN isolation and email flows remain unverified. Netlify is retained
for rollback under the [VOLO-245 retirement gates](netlify-retirement.md).

## Verified project settings

Inspected November 19, 2026:

| Setting | Value |
| --- | --- |
| Framework | Next.js preset, default build/output/install commands |
| Root directory | Repository root |
| Node.js | 24.x, changed from the new project's default 26.x |
| Git repository | RogerTerrill-NextJS/volo, already connected |
| Production branch | main |
| Auto-assign Custom Production Domains | Disabled; UI states deployments need manual promotion |
| System environment variables | Enabled |
| Initial production origin | https://volo-six-woad.vercel.app, selected by user; Production-only VOLO_MUTATION_ORIGIN saved |
| Project variables/deployments | None at initial inspection; see verification record for later changes |

Keep PR previews automatic. Do not disable all Git deployments or create another
staging environment. Next.js server output, Proxy, Server Actions and Sharp run
through Vercel's native Next.js integration; no static export, Netlify adapter or
catch-all SPA rewrite is needed. Confirm install/build commands and Node version
in the first real build log.

## Environment contract

Set the public Supabase URL and matching publishable key for Preview and
Production. Both select the existing Supabase project; previews share its data.
Do not put CLI management tokens or database passwords in this web project.

`SUPABASE_SECRET_KEY` is server-only and is required by the implemented
administrative invitation provider when that flow is enabled. It is not required
for ordinary member reads or login. `VOLO_CONFIRMATION_KEYS` is server-only JSON
for invitation/recovery transport encryption when activated. Review the actual
existing Netlify configuration and enabled flows before copying either. During VOLO-244,
user provisioned the service key for Production and explicitly authorized a
separate Preview entry restricted to `feature/volo-244-vercel-migration` for
invitation verification. Keep that restriction; remove the temporary branch
entry after its review closes. Preserve
active/retiring confirmation keys across overlap rather than generating
incompatible replacements. Do not reveal values in logs, screenshots or tickets.

Production requires an explicit HTTPS `VOLO_MUTATION_ORIGIN` matching the chosen
production address. `VERCEL_PROJECT_PRODUCTION_URL` does not choose this value:
Vercel's shortest-domain selection might differ from the reviewed address.
Environment changes require a new build; they do not modify an existing artifact.

For Preview, `VERCEL_ENV=preview` and bare `VERCEL_URL` select the single trusted
origin at build time. A configured local origin or production address cannot
override this. Missing/malformed metadata, unsupported hosted environments and
simultaneous Netlify/Vercel markers fail closed. Only public origin metadata is
exposed through Next config `env`; secrets must never be added there.

## Canonical previews and Auth

Use the exact deployment URL for review and sign-in. When Vercel supplies
`VERCEL_BRANCH_URL`, its branch alias redirects page GET/HEAD navigation to the
exact deployment before reading/refreshing a session. The redirect drops query
parameters and uses no-referrer/no-store. Alias mutations and `/auth/confirm`
requests are rejected rather than forwarding passwords, request bodies or email
tokens. Cookies are origin-scoped: the canonical preview needs its own login.
If branch metadata is unavailable (for example, a non-Git deployment), use only
the exact deployment URL and verify any additional alias behavior before review.

Only reviewed exact canonical `/auth/confirm` destinations may be added to
Supabase Auth. For Vercel this may be the immutable deployment hostname rather
than Netlify's numbered PR hostname. This is a provider-specific exception to
the old Netlify preview rule, not permission for a wildcard. Record exact SHA
and URL, remove superseded callbacks and do not forward tokens between origins.
Keep the existing Supabase Site URL until the approved production cutover.

Invitation/recovery testing also requires reviewing email templates, encrypted
transport configuration, current backend grants/cron health and platform
ingress-log protection for token/resume query values. Do not activate these
flows merely because login works. There is no database migration required solely
to move the frontend host; do not reset/rebuild hosted Supabase.

## Preview checks and release

See [migration verification](volo-244-verification.md), the
[preview checklist](preview-verification.md) and [private caching](private-caching.md).
Vercel consumes its targeted cache header; inspect `x-vercel-cache` as well as
browser/generic CDN policy. `MISS` alone does not establish non-storage or prove
the absence of application/runtime caching. Preserve stricter inconclusive
results in the existing anonymous cache reporter.

For a user-requested production batch:

1. Record exact reviewed main SHA, passing CI/full release suite, canonical
   production hostname and current Netlify rollback artifact/configuration.
2. Confirm auto-assignment is still disabled. Build with Production variables
   and explicit canonical origin; inspect the completed artifact and its SHA.
   Promoting a Preview rebuilds with Production variables, so its review is not
   proof of the resulting Production artifact. Prefer the completed unpublished
   Production build for promotion without rebuild.
3. Under the release authorization, promote that exact completed Production
   artifact and perform only the approved domain/DNS/Auth Site URL changes.
   Record TLS/domain status and the actual production pointer after promotion.
4. Verify production independently: health, anonymous denial, login/session,
   relevant admin/profile/directory/flight/message flows, private caching,
   callbacks where activated, fresh browser and existing browser/PWA behavior.
   A domain change requires login again and does not move origin-scoped cookies
   or an installed service worker.
5. Recheck manual promotion and keep Netlify available through the agreed
   rollback/retention checkpoint. VOLO-245 owns later archival and obsolete
   Netlify check/integration removal.

`voloapp.netlify.app` cannot be transferred to Vercel. Confirm whether the new
production address is the existing Vercel project domain or a user-owned custom
domain; do not assume an old Netlify URL redirects after archival. The first
Vercel release has no earlier Vercel production artifact: rollback requires the
retained Netlify app/old address, or an approved custom-domain route reversal,
plus compatible Supabase Auth settings. Frontend rollback does not restore data.

## Platform references

- [Manual production promotion](https://vercel.com/docs/deployments/promoting-a-deployment)
- [System build metadata](https://vercel.com/docs/environment-variables/system-environment-variables)
- [Generated URLs](https://vercel.com/docs/deployments/generated-urls)
- [Targeted CDN cache policy](https://vercel.com/docs/caching/cache-control-headers)
- [Vercel response/cache headers](https://vercel.com/docs/headers/response-headers)
