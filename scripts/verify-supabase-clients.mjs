import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

// Real SDK + real Next request contexts, with fictional sessions and loopback Auth only.
const root = path.resolve(import.meta.dirname, "..");
const fixture = await mkdtemp(path.join(tmpdir(), "volo-clients-"));
const unexpected = [];
let calls = 0;
const auth = createServer((request, response) => {
  if (request.method === "POST" && request.url === "/auth/v1/logout?scope=local") {
    response.writeHead(204).end();
    return;
  }
  if (request.method !== "GET" || request.url !== "/auth/v1/user") {
    unexpected.push(`${request.method} ${request.url}`);
    response.writeHead(400).end();
    return;
  }
  calls++;
  const token = request.headers.authorization?.split(" ")[1];
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ id: claims.sub, aud: "authenticated", role: "authenticated",
    email: `${claims.sub}@example.invalid`, app_metadata: {},
    user_metadata: { padding: claims.large ? "x".repeat(6000) : "" }, created_at: "2026-01-01T00:00:00Z" }));
});
let server;
let output = "";
const put = async (name, content) => {
  await mkdir(path.dirname(path.join(fixture, name)), { recursive: true });
  await writeFile(path.join(fixture, name), content);
};
const jar = () => new Map();
function absorb(response, cookies) {
  const values = response.headers.getSetCookie();
  for (const value of values) {
    assert.match(value, /; Path=\//i);
    assert.match(value, /; SameSite=Lax/i);
    const pair = value.split(";", 1)[0];
    const index = pair.indexOf("=");
    const name = pair.slice(0, index);
    if (/; Max-Age=0(?:;|$)/i.test(value)) cookies.delete(name);
    else {
      assert.match(value, /; Max-Age=\d+/i);
      assert.match(value, /; Expires=/i);
      cookies.set(name, pair.slice(index + 1));
    }
  }
  return values;
}
try {
  auth.listen(0, "127.0.0.1");
  await once(auth, "listening");
  const authOrigin = `http://127.0.0.1:${auth.address().port}`;
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_SUPABASE_URL: authOrigin,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_clients_fixture" };
  await symlink(path.join(root, "node_modules"), path.join(fixture, "node_modules"), "dir");
  await cp(path.join(root, "lib"), path.join(fixture, "lib"), { recursive: true });
  await cp(path.join(root, "tsconfig.json"), path.join(fixture, "tsconfig.json"));
  await put("package.json", JSON.stringify({ private: true, type: "module" }));
  await put("next.config.mjs", `export default { outputFileTracingRoot: ${JSON.stringify(fixture)} };`);
  await put("instrumentation.js", `export function register() {
    const original = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (url.origin !== ${JSON.stringify(authOrigin)}) throw new Error('Fixture forbids outbound requests');
      return original(input, init);
    };
  }`);
  await put("app/layout.jsx", 'export default function Layout({children}) { return <html><body>{children}</body></html>; }');
  await put("lib/fixture.js", `export function session(id, large = false) {
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    return { access_token: encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:id,exp:4102444800,large})+'.fictional-signature',
      refresh_token: 'fictional-refresh-'+id };
  }`);
  await put("app/api/session/route.js", `import {createServerSupabaseClient} from '../../../lib/supabase/server';
    import {session} from '../../../lib/fixture';
    export async function GET(request) {
      const params = new URL(request.url).searchParams;
      const headers = new Headers();
      try {
        const options = {cookieMode: params.get('mode') || 'read-write',
          setResponseHeaders: async values => {
            if (params.has('failHeaders')) throw new Error('fixture header sink failed');
            for (const [name,value] of Object.entries(values)) headers.set(name,value);
          }};
        if (params.has('omitHeaders')) delete options.setResponseHeaders;
        const client = await createServerSupabaseClient(options);
        const other = await createServerSupabaseClient({cookieMode:'read-only'});
        if (params.has('id')) {
          const {error} = await client.auth.setSession(session(params.get('id'), params.has('large')));
          if (error) throw error;
        }
        if (params.has('remove')) { const {error} = await client.auth.signOut({scope:'local'}); if(error) throw error; }
        const {data, error} = await client.auth.getUser();
        if (error && params.has('id')) throw error;
        return Response.json({id:data.user?.id || null, isolated:client !== other}, {headers});
      } catch (error) { return Response.json({error:error.message}, {status:500}); }
    }`);
  await put("app/page.jsx", `import {createServerSupabaseClient} from '../lib/supabase/server';
    export default async function Page() {
      const client = await createServerSupabaseClient({cookieMode:'read-only'});
      const {data} = await client.auth.getUser();
      return <p>fictional-user:{data.user?.id || 'anonymous'}</p>;
    }`);
  await put("app/api/override/route.js", `import {createServerSupabaseClient} from '../../../lib/supabase/server';
    export async function GET(){let intercepted=0;
      const client=await createServerSupabaseClient({cookieMode:'read-only',fetch:(input,init)=>{intercepted++;return fetch(input,init);}});
      const other=await createServerSupabaseClient({cookieMode:'read-only'});
      const first=await client.auth.getUser();const second=await other.auth.getUser();
      return Response.json({intercepted,first:first.data.user?.id,second:second.data.user?.id});}`);
  await put("app/forbidden/page.jsx", `import {createServerSupabaseClient} from '../../lib/supabase/server';
    import {session} from '../../lib/fixture';
    export default async function Page() {
      try {
        const client = await createServerSupabaseClient({cookieMode:'read-write',setResponseHeaders:()=>{}});
        const {error} = await client.auth.setSession(session('forbidden-user'));
        if(error) throw error;
        return <p>unexpected success</p>;
      } catch(error) { return <p>write rejected:{error.message}</p>; }
    }`);
  const {stdout} = await promisify(execFile)(process.execPath,
    [path.join(root, "node_modules/next/dist/bin/next"), "build", fixture, "--webpack"],
    { cwd: fixture, env, maxBuffer: 8 * 1024 * 1024, timeout: 120000 });
  assert.ok(stdout.includes("/api/session"));
  // Reserve a loopback port; release before Next takes ownership.
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", fixture,
    "--hostname", "127.0.0.1", "--port", String(port)], { cwd: fixture, env, stdio: ["ignore", "pipe", "pipe"] });
  server.on("error", error => { output += error.message; });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", data => { output = (output + data).slice(-8000); });
  const origin = `http://127.0.0.1:${port}`;
  const request = (route, cookies = jar()) => fetch(origin + route, {
    headers: {Cookie: [...cookies].map(([name,value]) => `${name}=${value}`).join("; ")},
    signal: AbortSignal.timeout(10000) });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`Fixture exited: ${output}`);
    try { const response = await request("/api/session"); if(response.status === 200) { ready = true; break; } }
    catch { /* Startup only. */ }
    await delay(100);
  }
  assert.ok(ready, `Fixture not ready: ${output}`);
  const first = jar(), second = jar();
  const write = async (id, cookies, suffix = "") => {
    const response = await request(`/api/session?id=${id}${suffix}`, cookies);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get("cache-control"), "private, no-cache, no-store, must-revalidate, max-age=0");
    for(const field of ["cdn-cache-control","netlify-cdn-cache-control"]) assert.equal(response.headers.get(field),"no-store");
    assert.equal(response.headers.get("expires"), "0");
    assert.equal(response.headers.get("pragma"), "no-cache");
    const values = absorb(response, cookies);
    assert.deepEqual(await response.json(), {id, isolated:true});
    return values;
  };
  const [large] = await Promise.all([write("fictional-a", first, "&large=1"), write("fictional-b", second)]);
  assert.ok(large.length > 1, "Large sessions must exercise cookie chunking");
  for (const [id, cookies] of [["fictional-a", first], ["fictional-b", second]]) {
    const response = await request("/", cookies);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).replace(/<!--.*?-->/g, "").includes(`fictional-user:${id}`));
    assert.equal(response.headers.getSetCookie().length, 0);
    const read = await request("/api/session?mode=read-only", cookies);
    assert.equal((await read.json()).id, id);
  }
  console.log("PASS: concurrent clients and read-only Server Components isolate fictional sessions");
  const override=await request("/api/override",first);
  assert.deepEqual(await override.json(),{intercepted:1,first:"fictional-a",second:"fictional-a"});
  assert.equal(override.headers.getSetCookie().length,0);
  console.log("PASS: caller-owned fetch override is isolated to its server client");
  const replacement = await write("fictional-a", first);
  const removedChunks = replacement.filter(value => /Max-Age=0/i.test(value));
  assert.ok(removedChunks.length >= large.length, "Replacement must clear obsolete chunks");
  assert.equal(first.size, 1);
  const removal = await request("/api/session?remove=1", first);
  assert.equal(removal.status, 200, await removal.clone().text());
  for(const field of ["cdn-cache-control","netlify-cdn-cache-control"]) assert.equal(removal.headers.get(field),"no-store");
  const removalCookies = absorb(removal, first);
  assert.ok(removalCookies.length > 0 && removalCookies.every(value => /Max-Age=0/i.test(value)));
  assert.equal(first.size, 0);
  console.log("PASS: SDK chunk replacement, deletion and cookie options survive the Next adapter");
  for (const suffix of ["mode=invalid", "omitHeaders=1", "id=fictional-a&failHeaders=1"]) {
    const response = await request(`/api/session?${suffix}`);
    assert.equal(response.status, 500);
    assert.equal(response.headers.getSetCookie().length, 0);
    const {error} = await response.json();
    assert.match(error, /cookieMode|setResponseHeaders|fixture header sink failed/);
  }
  const forbidden = await request("/forbidden");
  assert.equal(forbidden.status, 200);
  const body = await forbidden.text();
  assert.ok(body.includes("write rejected:") && body.includes("Cookies can only be modified"));
  assert.equal(forbidden.headers.getSetCookie().length, 0);
  assert.ok(calls > 0);
  assert.deepEqual(unexpected, []);
  console.log("PASS: invalid ownership, header sink failure and prohibited cookie writes fail visibly");
} finally {
  if (server && server.exitCode === null) { server.kill(); await once(server, "exit"); }
  if (auth.listening) await new Promise(resolve => auth.close(resolve));
  await rm(fixture, {recursive:true,force:true});
}
