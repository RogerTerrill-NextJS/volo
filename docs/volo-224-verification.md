# VOLO-224 — Install metadata and icons

Step 1 of VOLO-90. Next's manifest route declares a stable same-origin `/` identity/start/scope, VOLO name, standalone display and white background/theme. The root metadata now supplies VOLO application/description and supported Apple web-app settings. File conventions emit browser/Apple icon links; PNG launch icons are 192/512px, Apple icon 180px, favicon 32px. Regenerate all from the vector with `node scripts/generate-pwa-icons.mjs` using existing sharp. Icons use an opaque white background and a padded dark V; no remote art/fonts or new dependency.

Exact manifest/icon paths bypass Proxy authentication so install metadata is available even with expired/broken cookies. Lookalike and child paths remain covered. No private HTML, RSC, API or auth callback caching was added; no worker, offline writes, install prompt or hosted operation is part of this change. VOLO-225 owns the minimal static-only worker; VOLO-92 owns the final mobile Safari/mobile Chrome/desktop device journey.

## Local evidence — 2026-10-26

- Matcher regression: initially failed on `/manifest.webmanifest`, passed after exact exclusions. Private lookalikes/child paths remain matched.
- All 8 existing Proxy unit tests passed.
- Existing compiled Proxy HTTP fixture passed: same-request/following-request cookie refresh, concurrent sessions, HTML/RSC/prefetch privacy, redirects, invalid credentials, Auth outages/timeouts and cleanup.
- That same build verifies actual manifest JSON/content type, 192/512/180 PNG dimensions/types, generated manifest/Apple links, mobile metadata, white theme, stable start/scope/id, and public assets with anonymous/malformed/outage cookies without Auth calls or cookie mutations. It reuses actual root metadata, omitting only remote Google fonts/CSS for this HTTP fixture.
- The first HTTP run exposed an outdated test expectation (`apple-mobile-web-app-capable`); the installed Next guide specifies `mobile-web-app-capable`. Correcting the assertion and placing the Auth-call baseline after fixture seeding made the targeted run pass. Product metadata uses the supported Next API.
- Type generation, TypeScript, focused ESLint and diff checks passed. The 512px icon was visually inspected.
- Independent review found no implementation defect and verified byte-for-byte icon reproducibility. It caught a consumed malformed-cookie jar in the new asset check; that check now uses a fresh malformed session cookie.

No full-suite/SQL run for static metadata and an exact Proxy matcher change. Local Auth fixtures are disposable and cleaned up. Actual mobile installation, standalone launch, installed-app update, worker exclusions and logout/offline cleanup are not claimed as passed here; carry those checks through VOLO-225/92. A browser's install prompt is not proof of those behaviors. Preview verification and production release verification must remain separate; production publishing stays locked.

Guides read: installed Next 16.3.8 manifest, app-icons, PWA and metadata references. External primary references: [Google install criteria](https://github.com/GoogleChrome/web.dev/blob/main/src/site/content/en/progressive-web-apps/install-criteria/index.md), [Apple web-app metadata](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariHTMLRef/Articles/MetaTags.html). Installed Next output takes precedence over older examples.
