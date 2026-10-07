import assert from "node:assert/strict";
import {execFile, spawn} from "node:child_process";
import {once} from "node:events";
import {cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {promisify} from "node:util";
import {startAccessFixture, accessKey, accessCanaries} from "../tests/helpers/access-fixture.mjs";

const root = path.resolve(import.meta.dirname, "..");
const directory = await mkdtemp(path.join(tmpdir(), "volo-protected-"));
const backend = await startAccessFixture();
const canaries = new Set(accessCanaries);
const privateContent = /Workspace overview|fixture-private-nested/;
let server, output = "";
const put = async (name, content) => {
  const file = path.join(directory, name);
  await mkdir(path.dirname(file), {recursive: true});
  await writeFile(file, content);
};
const clean = (value, label) => {
  for (const canary of canaries) assert.ok(!value.includes(canary), `Credential/error marker in ${label}`);
};
async function scan(folder) {
  for (const entry of await readdir(folder, {withFileTypes: true})) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) await scan(file);
    else clean(await readFile(file, "utf8"), "browser assets");
  }
}
const membershipCount = () => backend.calls.filter(call => call.service === "membership").length;
try {
  const env = {PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_SUPABASE_URL: backend.origin,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: accessKey};
  await symlink(path.join(root, "node_modules"), path.join(directory, "node_modules"), "dir");
  for (const name of ["lib", "app", "tsconfig.json", "proxy.ts"]) {
    await cp(path.join(root, name), path.join(directory, name), {recursive: true});
  }
  await put("package.json", JSON.stringify({private: true, type: "module"}));
  await put("next.config.mjs", `export default {outputFileTracingRoot:${JSON.stringify(directory)}};`);
  await put("app/layout.tsx", "export default function Layout({children}:{children:React.ReactNode}){return <html><body>{children}</body></html>}");
  await put("app/page.tsx", 'import Link from "next/link"; export default function Page(){return <main><h1>Public home</h1><Link href="/dashboard" prefetch={false}>Open dashboard</Link></main>}');
  await put("app/auth/confirm/page.tsx", "export default function Page(){return <p>Public callback fixture</p>}");
  await put("instrumentation.js", `export function register(){const original=globalThis.fetch;globalThis.fetch=(input,init)=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    if(url.origin!==${JSON.stringify(backend.origin)})throw new Error('Fixture forbids outbound requests');return original(input,init);};}`);
  // A nested entry runs independently of its parent page and retained layout.
  await put("app/(protected)/dashboard/nested/page.tsx", `import {getPageAccess} from '../../../../lib/auth/page-access';
    import AccessState from '../../_components/access-state';
    export default async function Page(){const access=await getPageAccess();
      if(access.status!=='authorized')return <AccessState status={access.status}/>;
      return <p>{'fixture-private-nested:'+access.member.role}</p>;}`);
  await promisify(execFile)(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "build", directory, "--webpack"],
    {cwd: directory, env, timeout: 120000, maxBuffer: 8 * 1024 * 1024});
  const reservation = createReservation();
  await reservation.ready;
  const port = reservation.server.address().port;
  await new Promise(resolve => reservation.server.close(resolve));
  server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", directory, "--hostname", "127.0.0.1", "--port", String(port)],
    {cwd: directory, env, stdio: ["ignore", "pipe", "pipe"]});
  server.on("error", error => {output += error.message;});
  for (const stream of [server.stdout, server.stderr]) stream.on("data", data => {output += data.toString();});
  const origin = `http://127.0.0.1:${port}`;
  const request = async (route, jar = new Map(), headers = {}) => {
    // Canonical RSC redirects are protocol negotiation, not authorization redirects.
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(origin + route, {redirect: "manual", headers: {
        cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "), ...headers}, signal: AbortSignal.timeout(15000)});
      const visible = new Headers(response.headers); visible.delete("set-cookie");
      clean(JSON.stringify([...visible]), "headers");
      const body = await response.text(); clean(body, "body");
      if (headers.RSC && response.status === 307) {
        const target = new URL(response.headers.get("location"), origin);
        assert.equal(target.origin, origin);
        if (target.pathname === new URL(origin + route).pathname && target.searchParams.has("_rsc")) {
          route = target.pathname + target.search; continue;
        }
      }
      return {response, body};
    }
    throw new Error("Too many canonical RSC redirects");
  };
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error("Fixture server exited");
    try {if ((await request("/api/health")).response.status === 200) {ready = true; break;}} catch { /* Startup. */ }
    await delay(100);
  }
  assert.ok(ready, "Fixture server starts");
  const privateHeaders = response => {
    const policy = response.headers.get("cache-control") ?? "";
    assert.match(policy, /private/, "Protected responses must be private");
    assert.match(policy, /no-store/, "Protected responses must not be stored");
  };
  const loginRedirect = ({response, body}, rsc = false) => {
    assert.doesNotMatch(body, privateContent);
    privateHeaders(response);
    if ([303, 307, 308].includes(response.status)) {
      assert.equal(new URL(response.headers.get("location"), origin).href, origin + "/login?reason=authentication-required");
    } else {
      assert.equal(response.status, 200);
      if (rsc) assert.match(body, /NEXT_REDIRECT;replace;\/login\?reason=authentication-required;/);
      else assert.equal(body.match(/<meta[^>]*http-equiv="refresh"[^>]*content="[^"]*url=([^"]+)"/)?.[1], "/login?reason=authentication-required");
    }
  };
  loginRedirect(await request("/dashboard"));
  const login = await request("/login");
  assert.equal(login.response.status, 200); assert.match(login.body, /Sign-in is not available yet/);
  console.log("PASS: anonymous dashboard redirects safely and public login exists");
  const seed = async (label, options) => {
    const account = await backend.seed(label, options);
    for (const value of account.jar.values()) canaries.add(value);
    return account;
  };
  const member = await seed("member"), admin = await seed("admin", {role: "admin"});
  for (const account of [member, admin]) {
    const before = membershipCount();
    const page = await request("/dashboard", account.jar);
    assert.equal(page.response.status, 200); assert.match(page.body, /Workspace overview/);
    assert.match(page.body, /aria-label="App navigation"/); privateHeaders(page.response);
    assert.equal(membershipCount(), before + 1);
  }
  for (const options of [{status: "disabled"}, {membership: "absent"}]) {
    const account = await seed("denied" + backend.cases.size, options);
    const page = await request("/dashboard", account.jar);
    assert.match(page.body, /Access denied/); assert.doesNotMatch(page.body, privateContent);
    assert.doesNotMatch(page.body, /aria-label="App navigation"/); privateHeaders(page.response);
  }
  member.entry.status = "disabled";
  assert.match((await request("/dashboard", member.jar)).body, /Access denied/);
  member.entry.status = "active";
  assert.match((await request("/dashboard", member.jar)).body, /Workspace overview/);
  const parallel = await Promise.all([request("/dashboard", member.jar), request("/dashboard", admin.jar)]);
  for (const page of parallel) assert.match(page.body, /Workspace overview/);
  console.log("PASS: member/admin access, denied membership, fresh revocation and concurrent isolation");
  const malformed = new Map([["sb-127-auth-token", "invalid-json"]]);
  const forged = new Map(member.jar), pair = [...forged][0];
  const session = JSON.parse(Buffer.from(pair[1].slice(7), "base64url")); session.access_token += "-forged";
  forged.set(pair[0], "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"));
  const revoked = await seed("revoked", {auth: "rejected"});
  for (const jar of [new Map(), malformed, forged, revoked.jar]) loginRedirect(await request("/dashboard", jar));
  for (const query of ["next=https://example.invalid", "next=//example.invalid", "next=%2F%2Fexample.invalid", "token=query-secret-canary", "reason=untrusted&next=https://example.invalid"]) {
    const result = await request("/dashboard?" + query); loginRedirect(result);
    assert.doesNotMatch(result.response.headers.get("location") ?? "", /query-secret-canary|example\.invalid/);
  }
  const state = encodeURIComponent(JSON.stringify(["", {children: ["(protected)", {children: ["dashboard", {children: ["__PAGE__", {}, null, "refetch"]}]}]}]));
  const variants = [{}, {RSC: "1"}, {RSC: "1", "next-router-prefetch": "1"},
    {RSC: "1", "next-router-state-tree": state}];
  for (const route of ["/dashboard", "/dashboard/nested"]) {
    for (const headers of variants) {
      const result = await request(route, new Map(), headers);
      assert.doesNotMatch(result.body, privateContent);
      // Static prefetch can intentionally omit dynamic content and its redirect.
      if (!headers["next-router-prefetch"]) {
        loginRedirect(result, Boolean(headers.RSC));
      }
      const disabled = await seed("variant" + backend.cases.size, {status: "disabled"});
      const denied = await request(route, disabled.jar, headers);
      assert.doesNotMatch(denied.body, privateContent); privateHeaders(denied.response);
    }
    const before = membershipCount();
    const authorized = await request(route, member.jar, {RSC: "1"});
    assert.match(authorized.response.headers.get("content-type"), /text\/x-component/);
    assert.match(authorized.body, route.endsWith("nested") ? /fixture-private-nested:member/ : /Workspace overview/);
    assert.equal(membershipCount(), before + 1); privateHeaders(authorized.response);
  }
  // This targeted request retains the group layout but independently renders the nested leaf.
  const beforeNested = membershipCount();
  const nested = await request("/dashboard/nested", member.jar, {RSC: "1", "next-router-state-tree": state});
  assert.match(nested.body, /fixture-private-nested:member/); assert.equal(membershipCount(), beforeNested + 1);
  console.log("PASS: HTML/RSC/prefetch and retained-layout nested boundaries; fixed login destination");
  for (const mode of ["down", "malformed", "null-row"]) {
    const account = await seed("membership" + mode, {membership: mode});
    const denied = await request("/dashboard", account.jar);
    assert.match(denied.body, /Unable to verify access/); assert.doesNotMatch(denied.body, privateContent);
    assert.match(denied.body, /href="\/dashboard"/); privateHeaders(denied.response);
    account.entry.membership = undefined;
    assert.match((await request("/dashboard", account.jar)).body, /Workspace overview/);
  }
  const outage = await seed("auth-down", {auth: "down"});
  const failure = await request("/dashboard", outage.jar);
  assert.equal(failure.response.status, 503); assert.doesNotMatch(failure.body, privateContent);
  assert.equal(failure.response.headers.getSetCookie().length, 0); privateHeaders(failure.response);
  for (const status of ["active", "disabled"]) {
    const account = await seed("expired-" + status, {expired: true, status});
    const result = await request("/dashboard", account.jar);
    const cookies = result.response.headers.getSetCookie(); assert.ok(cookies.length > 0);
    assert.ok(cookies.every(cookie => !/Max-Age=0(?:;|$)/i.test(cookie)));
    for (const cookie of cookies) {
      const pair = cookie.split(";", 1)[0], equal = pair.indexOf("=");
      account.jar.set(pair.slice(0, equal), pair.slice(equal + 1)); canaries.add(pair.slice(equal + 1));
    }
    assert.match(result.body, status === "active" ? /Workspace overview/ : /Access denied/);
    if (status === "disabled") assert.doesNotMatch(result.body, privateContent);
    privateHeaders(result.response);
    const refreshes = backend.calls.filter(call => call.service === "refresh").length;
    await request("/dashboard", account.jar);
    assert.equal(backend.calls.filter(call => call.service === "refresh").length, refreshes);
  }
  console.log("PASS: sanitized outages, fresh retry, cookie rotation and private response policies");
  for (const jar of [new Map(), member.jar]) {
    for (const route of ["/", "/login", "/api/health", "/auth/confirm"]) {
      assert.equal((await request(route, jar)).response.status, 200, route);
    }
    for (const route of ["/dashboard/missing", "/api/missing"]) {
      const result = await request(route, jar); assert.equal(result.response.status, 404, route);
      assert.doesNotMatch(result.body, privateContent);
    }
  }
  await scan(path.join(directory, ".next/static")); clean(output, "server output");
  assert.doesNotMatch(output, /unhandledRejection/); assert.deepEqual(backend.unexpected, []);
  console.log("PASS: public home/login/health/callback, unknown-route 404s and credential boundaries");
} finally {
  if (server && server.exitCode === null) {server.kill(); await once(server, "exit");}
  await backend.close(); await rm(directory, {recursive: true, force: true});
}

// Reservation owns its listener and avoids choosing a fixed fixture port.
import {createServer} from "node:net";
function createReservation() {
  const server = createServer(); server.listen(0, "127.0.0.1");
  return {server, ready: once(server, "listening")};
}
