# Deploy Preview routing verification

Current checks updated for VOLO-117; historical VOLO-109 evidence is below.
Pre-release checks use Netlify Deploy Previews;
VOLO has no separate staging environment.

## Repeatable HTTP checks

Run the production smoke suite against the preview linked from the pull request:

```sh
SMOKE_BASE_URL=https://deploy-preview-<PR-number>--voloapp.netlify.app npm test
```

This mode requires Node.js and the checked-out test file, starts no local server,
and does not require a local build or application credentials. Without
`SMOKE_BASE_URL`, the suite continues to start the local production server after
`npm run build`. Use only a URL origin, without credentials, a path, or a query.
The suite makes GET, HEAD, OPTIONS, and an unsupported POST to the health endpoint;
it does not access Supabase or write application data.

| Check | Expected result |
| --- | --- |
| `GET /` | 200, HTML with dashboard navigation |
| `GET /login` | 200, sign-in placeholder and home link |
| Anonymous `GET /dashboard` | Redirect to fixed `/login?reason=authentication-required`, no incoming query forwarded; no Workspace overview; private/no-store |
| Repeated anonymous `GET /dashboard?verification=volo-109` | Same safe login destination without forwarded query or workspace content |
| Anonymous dashboard RSC | Canonical `_rsc` negotiation followed by login redirect; no workspace content; no-store |
| `GET /api/health` | 200, JSON `{"status":"ok"}` |
| `HEAD /api/health` | 200, JSON content type and empty body |
| `OPTIONS /api/health` | 204, Allow includes GET, HEAD, OPTIONS |
| `POST /api/health` | 405; unsupported method does not render the homepage |
| Unknown `/dashboard/volo-109-missing` and `/api/volo-109-missing` | 404; no homepage fallback |

Dashboard denial is checked without executing browser JavaScript; redirects can
be HTTP redirects or the framework's streamed/RSC protocol. The dashboard is
dynamic and checks verified identity/current membership on each server request.
The homepage and login placeholder are public static pages.
`/api/health` is the dynamic Route Handler served by the OpenNext server function.
There is currently no valid multi-level UI page below `/dashboard`; the nested
API path and unknown deeper UI paths cover the routes available today. Add valid
deeper page cases when those pages are implemented.

## Browser checks

1. Open the preview's `/dashboard?verification=volo-116` anonymously. Confirm
   `/login`, the sign-in placeholder, and no workspace overview.
2. Reload. Confirm `/login` remains usable with no redirect loop.
3. Follow Back to home, then Open dashboard. Confirm navigation reaches login.
4. Use browser Back and Forward. Confirm the URL and visible page agree.
5. Check browser console errors and save the login-state screenshot.

Use `npm run test:protected-app` for authenticated/denied/outage/navigation cases
against fictional local services. Do not create hosted users or write membership
data for preview smoke tests. Previously delivered browser content cannot be
retracted by server checks; refresh/new server requests enforce current access.

Repeated HTTP requests do not substitute for these browser checks.

## Mutation verification

VOLO-117 ships reusable server-only guards, not a product mutation endpoint.
Run `npm run test:mutations` locally/CI for actual Next API and fetched/native
Server Action fixtures. They use fictional Auth/membership and record effects
independently, proving denied calls perform zero writes. Never deploy those fixture
routes or use hosted accounts/data to extend smoke coverage. Required CI verifies
the compiled origin configuration/default build and database policies; the current
preview can only prove that existing public/protected navigation remains intact.
The first actual mutation feature owns hosted authenticated integration checks.

## Recorded results

The [PR #6 preview](https://deploy-preview-6--voloapp.netlify.app/),
[immutable deploy](https://6ac59f6b7f12f80007345df7--voloapp.netlify.app/),
at commit `6cec73a`, passed all seven smoke tests on October 6, 2026.
Direct dashboard navigation with a query, browser reload, both application links,
and Back/Forward passed in Chrome. No console errors or warnings were captured
during those interactions. No deployment-specific routing failures were found.

These checks do not cover sessions, invitation/reset callbacks, private caching,
or database access. Those remain under VOLO-110 and VOLO-19.
