# Deploy Preview routing verification

VOLO-109, October 6, 2026. Pre-release checks use Netlify Deploy Previews;
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
| `GET /dashboard` | 200, HTML containing the dashboard heading and home link |
| Repeated `GET /dashboard?verification=volo-109` | 200, same route/query and server-delivered heading |
| `GET /api/health` | 200, JSON `{"status":"ok"}` |
| `HEAD /api/health` | 200, JSON content type and empty body |
| `OPTIONS /api/health` | 204, Allow includes GET, HEAD, OPTIONS |
| `POST /api/health` | 405; unsupported method does not render the homepage |
| Unknown `/dashboard/volo-109-missing` and `/api/volo-109-missing` | 404; no homepage fallback |

The dashboard heading is checked in the HTTP response without executing browser
JavaScript. The current `/` and `/dashboard` pages are server-prerendered at build
time; these checks do not claim request-time rendering of a personalized page.
`/api/health` is the dynamic Route Handler served by the OpenNext server function.
There is currently no valid multi-level UI page below `/dashboard`; the nested
API path and unknown deeper UI paths cover the routes available today. Add valid
deeper page cases when those pages are implemented.

## Browser checks

1. Open the preview's `/dashboard?verification=volo-109` directly. Check the
   dashboard heading and Workspace overview.
2. Reload. Confirm the path, query, heading, and overview remain intact.
3. Follow Back to home, then Open dashboard. Confirm both destinations render.
4. Use browser Back and Forward. Confirm the URL and visible page agree.
5. Check browser console errors and save a dashboard screenshot.

Repeated HTTP requests do not substitute for these browser checks.

## Recorded results

The [PR #6 preview](https://deploy-preview-6--voloapp.netlify.app/),
[immutable deploy](https://6ac59f6b7f12f80007345df7--voloapp.netlify.app/),
at commit `6cec73a`, passed all seven smoke tests on October 6, 2026.
Direct dashboard navigation with a query, browser reload, both application links,
and Back/Forward passed in Chrome. No console errors or warnings were captured
during those interactions. No deployment-specific routing failures were found.

These checks do not cover sessions, invitation/reset callbacks, private caching,
or database access. Those remain under VOLO-110 and VOLO-19.
