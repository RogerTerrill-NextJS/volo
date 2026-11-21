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
| Retained old address | https://voloapp.netlify.app/ |
| Last observed Netlify published source | `2e911f99c64b8045b10220907bd756c57b5ea702` |
| Supabase Site URL after cutover | `https://volo-six-woad.vercel.app` |
| Previous Supabase Site URL | `https://voloapp.netlify.app` |
| Retention checkpoint | Awaiting user decision; do not infer a deadline |

Both hosts' `/api/health` endpoints returned 200 with `{"status":"ok"}` during
this preparation. Health alone is not a backend compatibility or full rollback
test. Netlify's authenticated session expired; its exact retained deployment ID,
configuration and lock still require a fresh authenticated inspection. The last
authenticated inspection showed automatic production publishing locked.

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

## Credentials

Vercel metadata shows two separate `SUPABASE_SECRET_KEY` entries:

- Secret scoped to Preview branch `feature/volo-244-vercel-migration`.
- Secret scoped to Production.

Only the temporary Preview override is a cleanup candidate. Its value was not
read. Removing it requires confirmation for permanent removal and does not
strip credentials from already-built deployments. Record retained privileged
Preview artifacts and their separate disposition. Do not delete or rotate a
Supabase key shared with current production or the retained Netlify rollback.

## Execution and recovery

1. Resolve remaining migration verification and agree retention/old-link/PWA handling.
   User confirmed phone dashboard/profile/flights work at the new address; that
   did not separately identify the origin of an older installed PWA.
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

No project disablement, stopped builds, branch-rule save, credential deletion,
GitHub App uninstall, or Supabase change has occurred during this preparation.
