# Navigation loading feedback — 27 October 2026

Approved behavior: a thin fixed bar during internal link navigation. Existing prefetch flags, independent page authorization, private caching and native document-reload semantics are preserved. No new protected streaming/loading boundary or dependency.

## Implementation

All existing application Next Link imports use the shared ProgressLink wrapper. Next.js 16.3.8 useLinkStatus controls pending feedback. Composed onNavigate clears stale native feedback for accepted navigations even when cached routes skip pending; caller preventDefault remains honored. A root observer handles ordinary same-origin document anchors. External/modified/other-target/download/anchor-only clicks are excluded. The bar is indeterminate, does not intercept pointers or shift layout, announces Loading page and becomes static under prefers-reduced-motion.

Native feedback clears on Escape, document restoration, history traversal or another accepted client navigation. Browser toolbar Stop has no universal cross-browser notification; otherwise a cancelled/blocked document navigation expires after 30 seconds. This timeout only clears cosmetic feedback, never retries a request or reports completion.

## Verification

- Production app build passed with CI offline public Supabase fixture values.
- Next route type generation and TypeScript passed. Changed application files/new components/policy tests passed ESLint; final helper-file lint passed separately.
- New native navigation policy tests: 2 passed. They cover modifiers, secondary clicks, prevented events, other targets, external schemes/origins, downloads, query changes, empty/nonempty fragments, intentional same-address reloads and internal fragment destinations. Tests failed before implementation; an added empty-fragment regression failed before its fix.
- Existing local production smoke: all 8 passed, including protected HTML/RSC redirects/private cache policy and health/missing routes.
- Broader regular regression run exposed missing shared-component copies in partial application fixtures. Updated mutation/real-Auth fixture manifests and the relocated browser dashboard import rewrite. All 8 affected profile/directory fixture checks passed on targeted rerun. Tests/assertions were not weakened.
- Disposable local Next production fixture, without backend/accounts, verified: visible feedback during a four-second client transition; clearing on arrival; query navigation; a second client link superseding an in-flight navigation; error-route cleanup; same-document anchor exclusion; keyboard document navigation and full-document completion.
- Fixture-only UI simulated a document unload blocked after the native observer: bar became visible, caller-cancelled client navigation preserved cancellation, prefetched/cached client navigation cleared the bar, and Escape cleared the bar. This simulation does not claim a real browser Stop event can be detected.
- Reduced-motion CSS and restoration event cleanup reviewed; Safari/mobile device checks and live screen-reader testing were not performed.
- Independent review identified the cached-link cleanup gap; fixed and re-reviewed with no remaining substantive findings. No hosted data writes or production publish.

Screenshots: /tmp/volo-navigation-loading.png (delayed client navigation), /tmp/volo-native-navigation-loading.png (blocked document fixture). Disposable fixture code is outside the repository and is not shipped. Existing unrelated workspace changes were excluded from the PR.
