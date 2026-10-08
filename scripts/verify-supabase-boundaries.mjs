import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

// Compile the real configuration modules in a disposable app. Never load .env
// files or credentials from the working checkout into this verification app.
const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const fixture = await mkdtemp(path.join(tmpdir(), "volo-boundaries-"));
const secret = "sb_secret_boundary_canary_105";
const markers = [secret, "cli_token_boundary_canary_105", "db_password_boundary_canary_105"];
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_boundary_fixture",
  SUPABASE_SECRET_KEY: secret,
  SUPABASE_ACCESS_TOKEN: markers[1],
  SUPABASE_DB_PASSWORD: markers[2],
};
let server;
let output = "";
let browserHasUrl = false;
let browserHasPublishableKey = false;
const build = () => run(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "build", fixture, "--webpack"], {
  cwd: fixture, env, maxBuffer: 8 * 1024 * 1024, timeout: 120_000,
});
const put = async (name, content) => {
  await mkdir(path.dirname(path.join(fixture, name)), { recursive: true });
  await writeFile(path.join(fixture, name), content);
};
const assertPrivate = (content, label) => {
  for (const marker of markers) assert.ok(!content.includes(marker), `Private marker leaked in ${label}`);
};
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await scan(filename);
    else {
      const content = await readFile(filename);
      assertPrivate(content, path.relative(fixture, filename));
      if (filename.endsWith(".js")) {
        browserHasUrl ||= content.includes("https://example.supabase.co");
        browserHasPublishableKey ||= content.includes("sb_publishable_boundary_fixture");
      }
    }
  }
}

try {
  await symlink(path.join(root, "node_modules"), path.join(fixture, "node_modules"), "dir");
  await cp(path.join(root, "lib"), path.join(fixture, "lib"), { recursive: true });
  await cp(path.join(root, "tsconfig.json"), path.join(fixture, "tsconfig.json"));
  await put("package.json", JSON.stringify({ private: true, type: "module" }));
  await put("next.config.mjs", `export default { outputFileTracingRoot: ${JSON.stringify(fixture)} };`);
  await put("instrumentation.js", "export function register() { globalThis.fetch = () => { throw new Error('Boundary fixture forbids outbound requests'); }; }");
  await put("app/layout.jsx", 'export default function Layout({children}) { return <html><body>{children}</body></html>; }');
  await put("app/page.jsx", '"use client"; import {getSupabasePrivilegedConfig} from "../lib/supabase/privileged-config.mjs"; export default function Page() { return <p>{getSupabasePrivilegedConfig().secretKey}</p>; }');
  let failure;
  try { await build(); } catch (error) { failure = error; }
  assert.ok(failure, "Client import of privileged config must fail compilation");
  assert.match(failure.stdout + failure.stderr, /depends on "server-only".*only available in Server Components|only works in a Server Component|cannot be imported from a Client Component/);
  console.log("PASS: privileged config cannot enter a Client Component");

  await put("app/page.jsx", '"use client"; import {createServerSupabaseClient} from "../lib/supabase/server"; export default function Page() { return <p>{String(createServerSupabaseClient)}</p>; }');
  failure = undefined;
  try { await build(); } catch (error) { failure = error; }
  assert.ok(failure, "Client import of server factory must fail compilation");
  assert.match(failure.stdout + failure.stderr, /depends on "server-only".*only available in Server Components|only works in a Server Component|cannot be imported from a Client Component/);
  console.log("PASS: server client factory cannot enter a Client Component");
  for (const moduleName of ["proxy", "proxy-auth"]) {
    await put("app/page.jsx", `"use client"; import * as server from "../lib/supabase/${moduleName}"; export default function Page() { return <p>{Object.keys(server).join(',')}</p>; }`);
    failure = undefined;
    try { await build(); } catch (error) { failure = error; }
    assert.ok(failure, `${moduleName} must remain server-only`);
    assert.match(failure.stdout + failure.stderr, /depends on "server-only".*only available in Server Components|only works in a Server Component|cannot be imported from a Client Component/);
  }
  console.log("PASS: Proxy adapter and Auth transport cannot enter Client Components");
  for (const moduleName of ["access", "membership-transport", "page-access"]) {
    await put("app/page.jsx", `"use client"; import * as server from "../lib/auth/${moduleName}"; export default function Page() { return <p>{Object.keys(server).join(',')}</p>; }`);
    failure = undefined;
    try { await build(); } catch (error) { failure = error; }
    assert.ok(failure, `${moduleName} must remain server-only`);
    assert.match(failure.stdout + failure.stderr, /depends on "server-only".*only available in Server Components|only works in a Server Component|cannot be imported from a Client Component/);
  }
  console.log("PASS: verified access, page adapter and membership transport cannot enter Client Components");

  for (const moduleName of ["mutation-request", "mutation-input", "mutation", "route-mutation", "action-mutation"]) {
    if (process.argv.includes("--mutation-boundary-red") && moduleName === "mutation-request") {
      // Deliberately client-safe fixture stand-in proves the assertion can fail.
      await put("lib/auth/mutation-request.ts", (await readFile(path.join(root, "lib/auth/mutation-request.ts"), "utf8")).replace('import "server-only";\n', ""));
    }
    await put("app/page.jsx", `"use client"; import * as server from "../lib/auth/${moduleName}"; export default function Page() { return <p>{Object.keys(server).join(',')}</p>; }`);
    failure = undefined;
    try { await build(); } catch (error) { failure = error; }
    assert.ok(failure, `${moduleName} must remain server-only`);
    assert.match(failure.stdout + failure.stderr, /depends on "server-only".*only available in Server Components|only works in a Server Component|cannot be imported from a Client Component/);
  }
  console.log("PASS: all mutation request/input/guard/HTTP/Action modules reject Client Component imports");

  for (const moduleName of ["private-response", "protected-path"]) {
    const filename=`lib/http/${moduleName}.ts`;
    const source=await readFile(path.join(root,filename),"utf8");
    await put("app/page.jsx", `"use client"; import * as policy from "../lib/http/${moduleName}"; export default function Page(){return <p>{Object.keys(policy).join(',')}</p>;}`);
    await put(filename,source.replace('import "server-only";\n',""));
    await build(); // RED control: the client import succeeds without its marker.
    await put(filename,source);
    failure=undefined;
    try {await build();}catch(error){failure=error;}
    assert.ok(failure,`${moduleName} must remain server-only`);
    assert.match(failure.stdout+failure.stderr,/depends on "server-only".*only available in Server Components|only works in a Server Component|cannot be imported from a Client Component/);
  }
  console.log("PASS: private cache policy/path modules reject client imports; marker-removal controls compile");

  await put("app/public.jsx", '"use client"; import {getSupabasePublicConfig} from "../lib/supabase/public-config.mjs"; import {createBrowserSupabaseClient} from "../lib/supabase/client"; export default function Public() { const config = getSupabasePublicConfig(); const client = createBrowserSupabaseClient(); return <p>{config.url}|{config.publishableKey}|{client.auth ? "browser constructed" : "missing"}</p>; }');
  await put("app/page.jsx", 'import Public from "./public"; import {getSupabasePrivilegedConfig} from "../lib/supabase/privileged-config.mjs"; import {createServerSupabaseClient} from "../lib/supabase/server"; export default async function Page() { const client = await createServerSupabaseClient({cookieMode:"read-only"}); const config = getSupabasePrivilegedConfig(); return <main><Public/><p>{config.secretKey && client.auth ? "server configured" : "missing"}</p></main>; }');
  await put("app/api/config/route.js", 'import {getSupabasePrivilegedConfig} from "../../../lib/supabase/privileged-config.mjs"; export function GET() { return Response.json({configured: Boolean(getSupabasePrivilegedConfig().secretKey)}); }');
  await build();
  await scan(path.join(fixture, ".next/static"));
  assert.ok(browserHasUrl && browserHasPublishableKey, "Public URL and publishable key must be inlined in browser JavaScript");
  console.log("PASS: public URL and publishable key are inlined in browser JavaScript");
  console.log("PASS: browser bundles and source maps contain no private markers");

  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const { port } = reservation.address();
  await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
  server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", fixture, "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: fixture, env, stdio: ["ignore", "pipe", "pipe"],
  });
  server.on("error", (error) => { output += error.message; });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (data) => { output = (output + data).slice(-8000); });
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Fixture server exited: ${output}`);
    try {
      const response = await fetch(`${origin}/api/config`, { signal: AbortSignal.timeout(1000) });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { configured: true });
      ready = true;
      break;
    } catch { await delay(100); }
  }
  assert.ok(ready, `Fixture server failed to become ready: ${output}`);
  for (const [url, headers, type] of [["/", {}, "text/html"], ["/", {RSC: "1"}, "text/x-component"], ["/api/config", {}, "application/json"]]) {
    const response = await fetch(origin + url, { headers, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("content-type")?.includes(type));
    const body = await response.text();
    assertPrivate(body, `${url} ${type}`);
    assertPrivate(JSON.stringify([...response.headers]), "response headers");
    if (type === "text/html") {
      assert.ok(body.includes("sb_publishable_boundary_fixture"));
      assert.ok(body.includes("server configured"));
      assert.ok(body.includes("browser constructed"));
    }
  }
  console.log("PASS: HTML, RSC, JSON and response headers contain no private markers");
} finally {
  if (server && server.exitCode === null) {
    server.kill();
    await once(server, "exit");
  }
  await rm(fixture, { recursive: true, force: true });
}
