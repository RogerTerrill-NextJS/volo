# Navigation loading bar

## Intent

Make internal link clicks visibly responsive while Volo waits for the destination page. User chose a thin bar at the top of the screen over a spinner beside the clicked link.

## Behavior

- Show a fixed, thin, high-contrast top bar while internal navigation is pending; do not shift page content.
- Use indeterminate progress rather than a fabricated percentage. Provide a polite loading status for assistive technology and a static reduced-motion treatment.
- Clear the bar on navigation completion, failure/cancellation and restored documents. Support query-string navigation and repeated navigation without leaving a stuck bar.
- Ignore external links, downloads, new-tab/modifier clicks and same-page anchor jumps. Preserve normal browser behavior and form-specific pending feedback.
- Cover the existing Next.js links and ordinary internal document links using supported APIs and narrowly scoped browser events; do not patch fetch, history or router internals.

## Approaches

Selected: a shared top loading bar, consistent across pages without altering each link's visible label. Alternative: inline link spinners, which require repeated changes and can shift labels. Route loading fallbacks alone do not cover the time before navigation begins or ordinary document links.

## Constraints and implementation decisions

Keep current independent page authorization, disabled protected-link prefetching, private cache headers and document-restoration access rechecks. Do not introduce a new protected loading boundary merely for this feedback, as it can change streaming/redirect behavior. Reuse Next.js pending-navigation APIs where possible; no extra dependency or backend changes. The bar cannot shorten the server response time.

## Verification and release

Check delayed navigation, completion/error cleanup, successive links, query changes, keyboard activation, external/new-tab/download/anchor exclusion and reduced motion. Run focused checks and type/lint validation for changed files; use local fixtures for any signed-in tests. Prepare a reviewable change; production publication remains a separate user-requested release.
