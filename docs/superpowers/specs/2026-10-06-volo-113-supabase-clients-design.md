# VOLO-113: Supabase SSR client foundation

## Purpose and scope

Provide typed Supabase client factories that the upcoming session and auth work
can share. The approved design uses existing validated public configuration,
a browser client, and a new server client for every invocation/request, with
explicit read-only or writable cookie handling.

This ticket does not protect pages, implement authentication forms or callbacks,
refresh sessions in Proxy, authorize memberships, configure hosted redirects,
or release production. Those remain in VOLO-114/115/116/117/118 and
VOLO-21/22/23/107. Public routes keep their current behavior.

## Existing foundation

- Next.js 16.3.8 App Router, React 19.2.8, Node.js 24 and TypeScript strict mode.
- `lib/supabase/public-config.mjs` validates and returns only the public URL and
  publishable key, using literal environment reads for browser inlining.
- `lib/supabase/privileged-config.mjs` is server-only and optional. It is not
  used by these factories; ordinary user clients operate through RLS.
- `lib/supabase/database.types.ts` contains generated database types.
- Unit/smoke tests use Node's test runner; a disposable Next.js fixture tests
  compile-time server-only boundaries and scans assets/responses for canaries.
- Supabase SDK/SSR packages are not currently installed.

## Dependencies and modules

Add compatible stable `@supabase/supabase-js` and `@supabase/ssr` releases as
runtime dependencies and commit their resolved lockfile. Inspect the actual
installed exports, peer requirements and cookie types before implementing;
upstream main is reference material, not a substitute for installed behavior.
Keep the generated database types unchanged unless independently regenerated.

`lib/supabase/client.ts` exports `createBrowserSupabaseClient()`. It validates
public configuration on each call and delegates to
`createBrowserClient<Database>`. Use the SDK's browser cookie/session behavior,
including its normal browser-only instance reuse; do not introduce a server
singleton, custom localStorage session store, or privileged configuration.
Construction must remain safe during Client Component server rendering.

`lib/supabase/server.ts` imports `server-only` and exports:

```ts
createServerSupabaseClient(options: {
  cookieMode: 'read-only' | 'read-write'
})
```

The function is asynchronous, validates public configuration, obtains the
current request's cookie store with `await cookies()`, and constructs a new
`createServerClient<Database>` instance. It does not cache the client, cookie
store or session globally. The required mode makes cookie ownership explicit.
Reject invalid modes defensively without printing configuration or cookies.
Both factories return the typed SDK client; they never return environment
objects, raw session tokens or a privileged client to application UI.

## Cookie contract

Both server modes provide `getAll()` from the current request's cookie store.
Use the SSR library's bulk cookie adapter rather than deprecated get/set/remove
methods so chunked cookie handling remains the SDK's responsibility.

Read-only mode is for Server Components. It cannot persist refreshed sessions
or perform auth mutations. Where the installed SSR API permits omission of
`setAll`, omit it rather than supplying a no-op that hides persistence failures.
The SDK can warn if a read-only client encounters a required write. Documentation
must make clear that reliable refresh requires VOLO-114's Proxy and that callers
must use a writable context for sign-in, sign-out or other session changes.
Do not catch arbitrary SDK, configuration or storage failures.

Read-write mode is for Route Handlers and Server Actions before streaming.
Its `setAll` applies every cookie's name, value and supplied options to Next.js's
cookie store, including expiry/removal and chunk updates. Write failures must
propagate rather than being swallowed. Passing this mode from a Server Component
does not bypass Next.js restrictions and must fail if a write is attempted.

The implementation must honor the installed adapter's complete contract.
If that version supplies cache headers with cookie writes, preserve/provide an
explicit supported way for the owning response to apply them; do not silently
discard security-relevant metadata. Proxy request/response synchronization and
application-wide private caching remain in VOLO-114/118.

## Failure and security behavior

- Missing/invalid public settings fail through the existing sanitized validator.
- No factory performs identity verification or grants application access.
  Consumers must use verified identity and current membership guards later.
- No new route, hosted request, account, email or database write is needed to
  construct/test these factories.
- Never import the server factory into browser code. Never share a server client
  across requests or replace publishable configuration with service-role keys.
- SDK errors propagate to callers; do not log cookies/tokens or serialize SDK
  client/session objects into HTML, RSC, JSON or Client Component props.

## Verification

Use synthetic configuration and local test fixtures. Write meaningful failing
tests before the implementation, then verify:

1. Factories use validated public configuration even when privileged environment
   canaries are present; missing/invalid settings fail without values in errors.
2. Cookie reads belong to the current request. Concurrent server clients with
   different synthetic sessions cannot observe or overwrite each other's state.
3. Read-only construction/reads succeed without cookie writes. Writable adapters
   preserve options, multiple chunks and removals; a throwing store fails visibly.
   An invalid cookie mode fails. Exercise actual SDK cookie behavior with a local
   stub Auth endpoint where needed, rather than asserting only mock call counts.
4. A disposable Next.js fixture imports the real browser/server modules. Client
   imports of the server factory fail compilation; a valid client/server split
   builds and runs. Verify actual Next.js cookie reads/writes in a fixture Route
   Handler and read-only Server Component without adding production test routes.
5. Existing privileged-import and canary leak checks continue to pass. Browser
   factory builds retain public configuration inlining and generated table typing.
6. Type generation, TypeScript, ESLint, app build, unit/smoke and boundary checks
   pass. Hosted CI verifies the default build; local webpack is available for the
   existing host's documented Turbopack worker limitation.
7. The latest PR Deploy Preview passes public route smoke checks. These prove
   compatibility and availability, not real auth/session refresh or RLS behavior.

Keep app CI offline with its existing dummy public values. Any additional SDK
fixture uses a loopback stub, never the shared hosted Supabase backend. Do not
load checkout credential files into disposable boundary fixtures.

## Handoff and release

Document the imports, required cookie mode, request ownership, safe server-only
usage and read-only refresh limitation in the environment/client setup guide.
VOLO-114 will implement the Proxy adapter; VOLO-115 will verify identity and
membership; VOLO-21/22/23 will own auth mutations and user flows. Future callers
must preserve cookie/cache behavior on replacement responses.

Use a `feature/` branch, reviewed PR and Netlify Deploy Preview. Production
auto-publishing stays locked; merging does not release production. Record test
and preview evidence in VOLO-113 without any actual tokens or cookie contents.

## References

- Installed Next.js guide: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`.
- [Supabase SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs).
- [SSR server factory reference](https://github.com/supabase/ssr/blob/main/src/createServerClient.ts).
- [Environment contract](../../environment-configuration.md).
