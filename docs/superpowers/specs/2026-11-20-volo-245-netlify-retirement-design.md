# VOLO-245 Netlify retirement

Scope comes from [VOLO-245](https://outsidethecockpit.atlassian.net/browse/VOLO-245):
retire `voloapp` in Roger Terrill's Netlify team after the Vercel migration,
production verification and agreed rollback/retention checkpoint are complete.
The user requested work on this ticket on November 20, 2026.

Use reversible **Disable project** after preserving the deployment/configuration
record, moving the required preview check to Vercel, and stopping obsolete
project builds. Stopping builds alone retains the old hosted address; disabling
takes it offline. Permanent deletion does not fit this ticket. Keep GitHub,
Supabase, the Vercel project and the separate `volo-uy2m` project intact.

Keep Vercel PR previews automatic and production promotion manual. Preserve the
existing branch protections when replacing Netlify's required status. Do not
uninstall a shared GitHub App or rotate a Supabase key shared with production.
Retire only the temporary reviewed-branch Preview secret override, with explicit
confirmation for permanent removal; existing built artifacts need separate
disposition because removing a variable does not remove their credentials.

Retention duration and old-link/installed-PWA usage are awaiting the user.
VOLO-244's remaining verification gates are not waived by starting preparation.
See the [retirement runbook](../../netlify-retirement.md) for current evidence.
