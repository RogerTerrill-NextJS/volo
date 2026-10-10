import assert from "node:assert/strict";
import {execFile, spawn} from "node:child_process";
import {once} from "node:events";
import {cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {promisify} from "node:util";
import {startAccessFixture, accessKey, accessCanaries,invitationQueryKey} from "../tests/helpers/access-fixture.mjs";

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
  const reservation = createReservation();
  await reservation.ready;
  const port = reservation.server.address().port;
  await new Promise(resolve => reservation.server.close(resolve));
  const env = {PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_SUPABASE_URL: backend.origin,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: accessKey,SUPABASE_SECRET_KEY:invitationQueryKey,VOLO_MUTATION_ORIGIN:`http://127.0.0.1:${port}`};
  await symlink(path.join(root, "node_modules"), path.join(directory, "node_modules"), "dir");
  for (const name of ["lib", "app", "tsconfig.json", "proxy.ts"]) {
    await cp(path.join(root, name), path.join(directory, name), {recursive: true});
  }
  await put("package.json", JSON.stringify({private: true, type: "module"}));
  await put("next.config.mjs", `export default {outputFileTracingRoot:${JSON.stringify(directory)}};`);
  await put("app/layout.tsx", "export default function Layout({children}:{children:React.ReactNode}){return <html><body>{children}</body></html>}");
  await put("app/page.tsx", 'import Link from "next/link"; export default function Page(){return <main><h1>Public home</h1><Link href="/dashboard" prefetch={false}>Open dashboard</Link></main>}');
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
  const confirmUnavailable=await fetch(origin+'/auth/confirm?token_hash=provider_canary&type=invite',{redirect:'manual'});
  assert.equal(confirmUnavailable.status,503,'confirmation cannot retain a token without encryption configuration');
  assert.match(confirmUnavailable.headers.get('cache-control')??'',/private.*no-store/);
  assert.equal(confirmUnavailable.headers.get('referrer-policy'),'no-referrer');
  assert.ok(!(await confirmUnavailable.text()).includes('provider_canary'));
  const unclaimed=await fetch(origin+'/auth/confirm',{method:'POST',redirect:'manual',headers:{Origin:origin,'content-type':'application/x-www-form-urlencoded',Cookie:'volo-confirmation='+Buffer.alloc(32,1).toString('base64url')},body:'csrf='+Buffer.alloc(32,2).toString('base64url')});
  assert.ok(!unclaimed.headers.getSetCookie().some(value=>value.startsWith('volo-confirmation=')),'unclaimed failure preserves newer browser transport');
  assert.ok(ready, "Fixture server starts");
  const privateHeaders = response => {
    for(const field of ["cdn-cache-control","netlify-cdn-cache-control"]) assert.equal(response.headers.get(field),"no-store");
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
  assert.equal(login.response.status, 200); assert.match(login.body, /action="\/auth\/login"/);privateHeaders(login.response);
  console.log("PASS: anonymous dashboard redirects safely and public login exists");
  const seed = async (label, options) => {
    const account = await backend.seed(label, options);
    for (const value of account.jar.values()) canaries.add(value);
    return account;
  };
  const scanner=await seed('confirmation-expired',{expired:true}),beforeScanner=backend.calls.length;
  for(const options of [{method:'HEAD'},{headers:{Purpose:'prefetch'}},{headers:{'Next-Router-Prefetch':'1'}},{}, {route:'/auth/confirm'}]){
    const response=await fetch(origin+(options.route??'/auth/confirm?token_hash=provider_canary&type=invite'),{redirect:'manual',method:options.method??'GET',headers:{Cookie:[...scanner.jar].map(([key,value])=>key+'='+value).join('; '),...options.headers}});
    privateHeaders(response);assert.equal(response.headers.getSetCookie().length,0,'scanner GET/HEAD cannot refresh expired Auth cookies');assert.ok(!(await response.text()).includes('provider_canary'));
  }
  assert.equal(backend.calls.length,beforeScanner,'confirmation reads bypass Auth and membership refresh');
  const member = await seed("member"), admin = await seed("admin", {role: "admin"});
  loginRedirect(await request('/admin/invitations'));
  for(const headers of [{},{RSC:'1'},{RSC:'1','Next-Router-Prefetch':'1'}]){
    const count=backend.calls.filter(call=>call.service==='invitations').length;
    const denied=await request('/admin/invitations',member.jar,headers);
    if(!headers['Next-Router-Prefetch'])assert.match(denied.body,/Access denied/);assert.ok(!denied.body.includes('person+tag@example.invalid'));privateHeaders(denied.response);
    assert.equal(backend.calls.filter(call=>call.service==='invitations').length,count);
    const listed=await request('/admin/invitations',admin.jar,headers);
    if(!headers['Next-Router-Prefetch']){assert.match(listed.body,/person\+tag@example\.invalid/);assert.match(listed.body,/Revoked/);assert.match(listed.body,/Needs review/);}privateHeaders(listed.response);
  }
  assert.match((await request('/dashboard',admin.jar)).body,/href="\/admin\/invitations"/);
  assert.doesNotMatch((await request('/dashboard',member.jar)).body,/href="\/admin\/invitations"/);
  admin.entry.status='disabled';const disabledAdmin=await request('/admin/invitations',admin.jar);assert.match(disabledAdmin.body,/Access denied/);privateHeaders(disabledAdmin.response);admin.entry.status='active';
  const rows=backend.invitations.rows;backend.invitations.rows=[];
  const emptyAdmin=(await request('/admin/invitations',admin.jar)).body;
  assert.match(emptyAdmin,/No invitations yet/);assert.match(emptyAdmin,/Send invitation/);assert.match(emptyAdmin,/name="email"/);
  for(const [status,outcome,want,absent] of [['issued','accepted','Renew provider link','Check send status'],['issued','unknown','Check send status','Renew provider link'],['revoked','unknown',null,'Renew provider link'],['redeemed','accepted',null,'Renew provider link']]){
    backend.invitations.rows=[{...rows[0],status,invitation_send_attempts:[{invitation_version:2,outcome,reconciled_outcome:null}]}];
    const controlPage=(await request('/admin/invitations',admin.jar)).body;
    if(want)assert.ok(controlPage.includes(want));assert.ok(!controlPage.includes(absent));
    if(!want)assert.ok(!controlPage.includes('Check send status'));
  }
  backend.invitations.rows=[{...rows[0],status:'pending_issuance',auth_user_id:admin.entry.userId??'10000000-0000-4000-8000-000000000001',version:3,invitation_send_attempts:[{invitation_version:3,outcome:'rejected',reconciled_outcome:null}]}];
  const failedRenewal=(await request('/admin/invitations',admin.jar)).body;
  assert.match(failedRenewal,/Send failed/);assert.match(failedRenewal,/Renew provider link/);assert.match(failedRenewal,/name="expectedVersion" value="3"/);
  backend.invitations.rows=[{...rows[0],status:'issued',invitation_send_attempts:[{invitation_version:2,outcome:'accepted',reconciled_outcome:null}]}];
  const controlHtml=(await request('/admin/invitations',admin.jar)).body;
  const decode=value=>value.replaceAll('&quot;','"').replaceAll('&#x27;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
  const forms=[...controlHtml.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(match=>[...match[1].matchAll(/<input\b[^>]*>/g)].flatMap(input=>{const name=input[0].match(/name="([^"]+)"/)?.[1];return name?[[decode(name),decode(input[0].match(/value="([^"]*)"/)?.[1]??'')]]:[];}));
  assert.equal(forms.length,2);
  const invoke=async(account,index,fields={},headers={})=>{
    const body=new FormData();for(const [key,value] of forms[index])body.append(key,value);for(const [key,value] of Object.entries(fields))body.set(key,value);
    const response=await fetch(origin+'/admin/invitations',{method:'POST',redirect:'manual',headers:{Origin:origin,Cookie:[...account.jar].map(([key,value])=>`${key}=${value}`).join('; '),...headers},body});
    const text=await response.text();clean(text,'action response');
    // Next finalizes Server Action Cache-Control; use the existing mutation contract.
    assert.match(response.headers.get('cache-control')??'',/no-store/);
    for(const field of ['cdn-cache-control','netlify-cdn-cache-control'])assert.equal(response.headers.get(field),'no-store');
    return text;
  };
  for(const index of [0,1])assert.match(await invoke(member,index),/Access denied/);
  admin.entry.status='disabled';assert.match(await invoke(admin,1),/Access denied/);admin.entry.status='active';
  assert.match(await invoke(admin,0,{email:'not-an-email'}),/Invalid input/);
  assert.match(await invoke(admin,1,{expectedVersion:'1e2'}),/Invalid input/);
  assert.match(await invoke(admin,1,{role:'admin'}),/Invalid input/);
  await invoke(admin,1,{}, {Origin:'https://foreign.invalid'});
  assert.deepEqual(backend.unexpected,[],'Denied and malformed actual forms never reach privileged RPC/provider endpoints');
  backend.invitations.rows=rows;backend.invitations.failure='down';
  const unavailable=await request('/admin/invitations',admin.jar);assert.match(unavailable.body,/Unable to verify access/);assert.doesNotMatch(unavailable.body,/No invitations yet/);assert.match(unavailable.body,/href="\/admin\/invitations"/);privateHeaders(unavailable.response);backend.invitations.failure=null;
  backend.invitations.rows=[{...rows[0],recipient_email:'<script>alert(1)</script>@example.invalid'}];
  const escaped=await request('/admin/invitations',admin.jar);assert.ok(escaped.body.includes('&lt;script&gt;'));assert.ok(!escaped.body.includes('<script>alert(1)</script>'));
  backend.invitations.rows=rows;
  console.log('PASS: private invitation list, admin-only queries/navigation, HTML/RSC/prefetch denials and safe empty/error states');
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
