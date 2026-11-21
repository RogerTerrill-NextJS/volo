# Netlify retirement — VOLO-245

Status on November 20, 2026: preparation in progress; the old project is online.
[VOLO-245](https://outsidethecockpit.atlassian.net/browse/VOLO-245) remains gated
by VOLO-244 verification and an agreed rollback/retention checkpoint.

## Recorded endpoints and artifacts

| Item | Recorded value |
| --- | --- |
| Current production | https://volo-six-woad.vercel.app/ |
| Vercel project | VOLO / volo, team `volo7` |
| Published source | `799b154bdb9e041d28135ab0ec29e63fff1cb2b1` |
| Vercel production artifact | `ARZWdzryywsfiDJ25aJAb6YyFN7L` |
| Main release CI | [44854755992](https://github.com/RogerTerrill-NextJS/volo/actions/runs/44854755992), all three jobs passed |
| Retained Netlify project | `voloapp`, Roger Terrill's team |
| Netlify project ID | `1832e04b-8a6d-4f5e-9c43-b37866165479` |
| Retained old address | https://voloapp.netlify.app/ |
| Last observed Netlify published source | `2e911f99c64b8045b10220907bd756c57b5ea702` |
| Published Netlify artifact | [6aff8711b5988472ad08ebd5](https://app.netlify.com/projects/voloapp/deploys/6aff8711b5988472ad08ebd5), Published & locked |
| Retained immutable URL | https://6aff8711b5988472ad08ebd5--voloapp.netlify.app/ |
| Supabase Site URL after cutover | `https://volo-six-woad.vercel.app` |
| Previous Supabase Site URL | `https://voloapp.netlify.app` |
| Retention checkpoint | Retain through November 27, 2026, Pacific time; retirement no earlier than November 28, subject to remaining gates |

Both hosts and the retained immutable Netlify artifact served `{"status":"ok"}`
from `/api/health` during preparation. Health alone is not a backend compatibility
or full rollback test. After the user signed in, authenticated Netlify inspection
confirmed the account/team, project ID, exact retained artifact, production
context and **Published & locked** state. The newer `799b154` Netlify production
build is completed but not published.

Retained configuration metadata: repository `RogerTerrill-NextJS/volo`, production
branch `main`, runtime Next.js, Node.js 24, build command `npm run build`, publish
directory `/.next`, builds **Active**. Public Supabase variables have two values
in two deploy contexts. The Netlify service secret is Production-only, scoped to
Builds/Functions/Runtime; its Deploy Previews context is empty. Values were not
exported. Preserve this configuration in Netlify for recovery.

The user selected seven days of retention through November 27 and reports no
users of the old Netlify URL or a PWA installed from it. Interpret “through” as
keeping it available for the whole Pacific calendar day; this is not approval
to disable it before the remaining migration gates pass.

## PR checks and integration scope

GitHub's authenticated classic branch rule `84354093` for `main` currently requires:

- `Typecheck, lint, build and test`.
- `netlify/voloapp/deploy-preview`, bound to the Netlify publisher.

It also requires a PR, up-to-date branches, conversation resolution and admin
enforcement; force pushes and deletions are disallowed. Public API rulesets are
empty, which does not mean the classic protection rule is absent.

Reviewed PR #126's head `2741321952d27ae00563ffc2b64b04b9a0c0fe85` has successful
`Vercel` and `netlify/voloapp/deploy-preview` commit statuses. Its three GitHub
Actions jobs passed. Netlify also reports Header rules, Redirect rules and
Pages changed checks. The repository has only `.github/workflows/ci.yml`; there
is no Netlify Actions workflow to delete.

Before stopping Netlify, verify a fresh Vercel PR preview and replace only the
Netlify required context with the trusted `Vercel` context. Preserve all other
branch protections. Record the saved rule and subsequent PR checks. Do not
remove the Netlify GitHub App account-wide: other projects, including the
separately prepared `volo-uy2m`, may depend on it.

The branch-rule picker identified the exact `Vercel` context with publisher
`@vercel`. That audit selection was discarded without saving the rule.

| Required check | Current | Prepared retirement change |
| --- | --- | --- |
| Application validation | `Typecheck, lint, build and test` | Keep |
| Preview deployment | `netlify/voloapp/deploy-preview` from Netlify | Replace with `Vercel` from Vercel |

## Credentials

The initial audit found two separate `SUPABASE_SECRET_KEY` entries:

- Secret scoped to Preview branch `feature/volo-244-vercel-migration`.
- Secret scoped to Production.

On November 20, the user explicitly approved permanent removal of only the
temporary branch-scoped Preview override. The Vercel confirmation identified
Preview as its environment. After deletion, metadata showed the separate
Production secret still present and no Preview secret override. Production
`/api/health` continued to return 200 with `{"status":"ok"}`. No value was exported
and the underlying shared Supabase key was not revoked or rotated.

Removing the variable does not strip credentials from already-built deployments.
Record retained privileged Preview artifacts and their separate disposition;
no deployment deletion has been authorized or performed. Do not delete or rotate
a Supabase key shared with current production or the retained Netlify rollback.

## Execution and recovery

1. Resolve remaining migration verification and retain Netlify through November
   27, Pacific time. User confirmed phone dashboard/profile/flights work at the
   new address and reports no remaining use of the old address/installed PWA.
2. Preserve the authenticated Netlify artifact/configuration record and review
   compatibility with the unchanged Supabase backend and current Auth settings.
3. Verify and apply the scoped required-check replacement and credential cleanup.
4. Stop `voloapp` builds, then use reversible **Disable project** after the gates
   are satisfied. This takes the old address offline. Do not use Delete project.
5. Verify Vercel health, login/anonymous denial, manual production promotion and
   automatic PR previews. Record final settings and remaining limitations.

[Stopping builds](https://docs.netlify.com/build/configure-builds/stop-or-activate-builds/)
prevents new production, branch and PR preview builds. Netlify's supported
[Disable project](https://docs.netlify.com/manage/projects/disable-project/)
preserves configuration and provides **Enable project** for recovery. Enabling
the project alone does not restore Supabase Site URL, callbacks or data. A return
to the old address requires an approved rollback, compatible retained frontend
and explicit Auth/domain configuration restoration. Never reset the database as
part of frontend recovery.

Only the approved Preview configuration entry has been deleted. No project
disablement, stopped builds, branch-rule save, deployment deletion, GitHub App
uninstall, or Supabase change has occurred during this preparation.
