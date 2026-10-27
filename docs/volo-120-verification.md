# VOLO-120 cache investigation — 27 October 2026

**Status: partial work; hosted non-storage verification remains unresolved.** The user confirmed that Netlify has not replied to the original support request. This PR improves the existing reporter and records one bounded anonymous run. It does not close VOLO-120 or certify beta readiness.

## Confirmed references and reporter changes

[Netlify's cache documentation](https://docs.netlify.com/build/caching/caching-overview/#debug-with-cache-status) distinguishes edge misses from hits and shows `stored=true` in durable-cache examples. The reporter previously treated that explicit true token as unknown. It now fails conservatively on both that form and RFC Boolean `stored`/`stored=?1`. A `false` token still cannot certify non-storage. [RFC 9211](https://www.rfc-editor.org/rfc/rfc9211.html#section-2.5) defines `stored` as a Boolean meaningful with forwarding; omission does not provide affirmative non-storage evidence.

The reporter now completes its bounded matrix after response-check failures, records only whitelisted headers, cookie counts, request IDs, timestamps, elapsed time and body SHA-256, and summarizes distinct categories. Missing no-store, explicit hit/storage, unexpected content/cookies, status/destination errors and positive Age remain failures (exit 1). Positive Age is labeled `age-anomaly`, not inferred hit/storage. Missing/malformed/unknown forwarding evidence remains inconclusive (exit 2 when no failing checks). Passing also requires a reported public/static hit control. Bodies, cookie values and credentials are never printed.

No application cache policy, middleware, Auth behavior, dependencies or CI gate was changed. The added login observations are private checks too. RSC negotiation stays bounded and same-origin; the reporter supplies no randomized cache-busting URLs or request cache directives.

## Exact deployment and run

Read-only Netlify UI verified a successful Deploy Preview from merged PR #120:

- Head: `757ac0311708690afa788aa1531a4a890cf1edc3` (VOLO-112).
- Deploy: `6ae1155b56ba34e7b403d95a`; [deploy details](https://app.netlify.com/projects/voloapp/deploys/6ae1155b56ba34e7b403d95a).
- Tested immutable [preview permalink](https://6ae1155b56ba34e7b403d95a--voloapp.netlify.app/), rather than a changing branch alias.
- Observation window: **2026-10-27 21:50:47.705–21:51:09.822 UTC**.

```sh
SMOKE_BASE_URL=https://6ae1155b56ba34e7b403d95a--voloapp.netlify.app node scripts/verify-preview-cache.mjs
```

One run, **exit 1**: 64 requests including bounded RSC negotiation; 58 private responses, six public controls. Repeated inputs were `/`, the existing homepage query canary, `/dashboard`, login, health and one hashed JS asset. Protected routes included HTML, RSC, prefetch and HEAD, repeated three times. Server-requested RSC canonicalization accounts for additional requests.

| Observation | Result |
| --- | --- |
| Private policy | All 58: `private, no-cache, no-store, must-revalidate, max-age=0`; `CDN-Cache-Control: no-store`. Targeted Netlify field absent downstream, which alone is not a policy failure. |
| Private Cache-Status | All: durable `fwd=bypass`, edge `fwd=miss` with forwarding status; no private hit/stored marker. All 58 lack affirmative edge non-storage evidence. |
| Private Age | Eight responses had Age 1–8; all other private observations had Age 0. Only failure category: `age-anomaly`. |
| Content/cookies/navigation | No unexpected private content or Set-Cookie, status, destination or negotiation-limit failure reported. No credentials supplied or bodies retained. |
| Public controls | Three health responses: no-cache, bypass/miss, Age 0. Hashed JS: public immutable, two `stored` misses at Age 0 then one explicit edge hit at Age 12. Positive control observed. |

Age anomaly trace samples (all from this single run):

| UTC timestamp | Request variant | Age / elapsed ms | Netlify request ID |
| --- | --- | --- | --- |
| 21:50:47.705 | login HTML | 4 / 5448 | `01M5ZNGBQ41XATPEHC4EQ6TB5S` |
| 21:50:53.789 | home canonical RSC | 1 / 356 | `01M5ZNGHE3QAZYQPCRBFCZK72X` |
| 21:50:54.751 | home query HTML | 1 / 461 | `01M5ZNGJC8HFBDME9F857BKF88` |
| 21:50:55.821 | dashboard HTML | 2 / 172 | `01M5ZNGKBRPKEEVX3PBMMK0KCT` |
| 21:51:00.209 | home query canonical RSC | 8 / 4477 | `01M5ZNGQMWSC2K8A1RK24T9N3Q` |
| 21:51:05.907 | dashboard canonical RSC | 1 / 126 | `01M5ZNGX6W92RNC833ZKN9330J` |
| 21:51:06.911 | home HTML | 1 / 121 | `01M5ZNGY6AD87ZDQH3NJAF7H1X` |
| 21:51:07.919 | home query canonical RSC | 1 / 138 | `01M5ZNGZ5WACFPHC211ATND349` |

Full sanitized observations are saved locally in the ignored `.superpowers/sdd/2026-10-27-volo-120-cache-evidence/preview-observations.jsonl`. No unchanged hosted run was repeated to chase a pass. Final local tightening rejects unknown forwarding values and explicitly preserves the prior private login policy and HTTP 200 requirements; the recorded deployment already satisfies those checks. Observed `bypass`/`miss` behavior is unchanged and covered by local regression fixtures.

## Tests and remaining requirements

**13 targeted reporter tests passed**, as did focused ESLint, local documentation link checks and `git diff --check`. Reporter regression tests cover explicit Boolean/token true, missing/miss-only/false-token evidence, malformed or unknown forwarding, continued sampling after Age failures, policy-failure precedence, public hit controls and existing homepage redirect/prefetch/query checks. The existing seven tests remain. The full application suite was not run for this reporter-only change.

Independent review caught a login status regression from the consolidation: later login redirects could pass. A failing regression reproduced it, then restoring the exact HTTP 200 check made it pass. Author review also preserved the private login policy check with a failing-then-passing test. Independent review reported no remaining blockers after these fixes. Review did not repeat hosted traffic.

The original request subject was “Clarify Age and edge non-storage reporting for no-store Next.js preview responses”, submitted 8 October; no ticket number was displayed. Original traces: `01M4CSARN5ARP1SDST4RC3CYG7` and `01M4CSB59ZRATBGJ44NZVEDPAT`. No new support message was sent.

To finish VOLO-120, obtain Netlify's explanation for those traces and the new samples: whether either layer stored/reused responses, why Age can be positive on bypass/miss, whether omission of stored=false is expected, and which supported header/log/Observability field proves non-storage. Public documentation does not answer these project-specific trace questions. Do not infer the cause from elapsed time or relax the Age gate based on this run.

Authenticated hosted isolation remains owned by VOLO-110 and requires its bounded account/write authorization; this anonymous check provides none of that proof. Production publishing/settings and shared Supabase data/Auth/Storage were untouched. There is no staging environment.
