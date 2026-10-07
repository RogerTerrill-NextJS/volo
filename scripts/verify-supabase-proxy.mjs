import assert from "node:assert/strict";
import {execFile, spawn} from "node:child_process";
import {once} from "node:events";
import {cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import path from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {promisify} from "node:util";
import {startAuthFixture, fixtureKey, cookieHeader} from "../tests/helpers/proxy-auth-fixture.mjs";

const root = path.resolve(import.meta.dirname,"..");
const fixture = await mkdtemp(path.join(tmpdir(),"volo-proxy-"));
const auth = await startAuthFixture();
const key = "sb-127-auth-token";
const forbidden = ["private-upstream-error-canary", "fixture-refresh-", "fictional-signature"];
const cookieCanaries = new Set();
let server;
let output = "";
const assertClean = (content,label) => {
  for(const marker of [...forbidden,...cookieCanaries]) assert.ok(!content.includes(marker),`Sensitive fixture marker leaked in ${label}`);
};
const put = async (name,content) => {
  await mkdir(path.dirname(path.join(fixture,name)),{recursive:true});
  await writeFile(path.join(fixture,name),content);
};
function absorb(response,jar) {
  const values = response.headers.getSetCookie();
  for(const value of values) {
    assert.match(value,/; Path=\//i); assert.match(value,/; SameSite=Lax/i);
    const pair = value.split(";",1)[0]; const split = pair.indexOf("=");
    const name = pair.slice(0,split);
    if(/; Max-Age=0(?:;|$)/i.test(value)) jar.delete(name);
    else {assert.match(value,/; Max-Age=\d+/i); assert.match(value,/; Expires=/i); jar.set(name,pair.slice(split+1));}
  }
  return values;
}
async function scan(directory) {
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const filename = path.join(directory,entry.name);
    if(entry.isDirectory()) await scan(filename); else assertClean(await readFile(filename,"utf8"),"browser assets");
  }
}
try {
  const env = {PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NEXT_TELEMETRY_DISABLED:"1",
    NEXT_PUBLIC_SUPABASE_URL:auth.origin,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:fixtureKey};
  await symlink(path.join(root,"node_modules"),path.join(fixture,"node_modules"),"dir");
  await cp(path.join(root,"lib"),path.join(fixture,"lib"),{recursive:true});
  await cp(path.join(root,"tsconfig.json"),path.join(fixture,"tsconfig.json"));
  await put("package.json",JSON.stringify({private:true,type:"module"}));
  await put("next.config.mjs",`export default {outputFileTracingRoot:${JSON.stringify(fixture)}};`);
  const proxySource = await readFile(path.join(root,"proxy.ts"),"utf8");
  // Add a fixture-only replacement branch to the real entry; retain its exact matcher/helper.
  await put("proxy.ts",'import {NextResponse} from "next/server";\n'+proxySource.replace(
    "return (await refreshSupabaseSession(request)).response;",
    'const result = await refreshSupabaseSession(request); if(request.nextUrl.pathname === "/fixture-redirect") return result.finalizeResponse(NextResponse.redirect(new URL("/",request.url),303)); return result.response;'));
  await put("instrumentation.js",`export function register(){const original=globalThis.fetch;globalThis.fetch=(input,init)=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    if(url.origin!==${JSON.stringify(auth.origin)}) throw new Error('Fixture forbids outbound requests');return original(input,init);};}`);
  await put("app/layout.jsx",'export default function Layout({children}){return <html><body>{children}</body></html>;}');
  await put("app/page.jsx",`import {createServerSupabaseClient} from '../lib/supabase/server';
    export default async function Page(){const client=await createServerSupabaseClient({cookieMode:'read-only'});
    const {data}=await client.auth.getUser();return <p>{'fictional-user:'+(data.user?.id||'anonymous')}</p>;}`);
  await put("app/dashboard/report.csv/page.jsx",'export {default} from "../../page";');
  await put("app/auth/confirm/page.jsx",'export default function Page(){return <p>public auth fixture</p>;}');
  await put("app/api/health/route.js",'export function GET(){return Response.json({status:"ok"});}');
  await put("public/file.svg",'<svg xmlns="http://www.w3.org/2000/svg"/>');
  await put("app/api/seed/route.js",`import {createServerSupabaseClient} from '../../../lib/supabase/server';
    export async function POST(request){const {id}=await request.json();const headers=new Headers();
      const client=await createServerSupabaseClient({cookieMode:'read-write',setResponseHeaders:values=>{
        for(const [key,value] of Object.entries(values))headers.set(key,value);}});
      const {error}=await client.auth.signInWithPassword({email:id+'@example.invalid',password:'fictional-password'});
      return Response.json({ok:!error},{status:error?500:200,headers});}`);
  await put("app/api/private/route.js",`import {createServerSupabaseClient} from '../../../lib/supabase/server';
    export async function GET(){const client=await createServerSupabaseClient({cookieMode:'read-only'});const {data,error}=await client.auth.getUser();
      return error||!data.user ? Response.json({error:'Unauthorized'},{status:401}) : Response.json({id:data.user.id,private:true});}`);
  await promisify(execFile)(process.execPath,[path.join(root,"node_modules/next/dist/bin/next"),"build",fixture,"--webpack"],
    {cwd:fixture,env,maxBuffer:8*1024*1024,timeout:120000});
  await scan(path.join(fixture,".next/static"));
  const reservation=createServer(); reservation.listen(0,"127.0.0.1");await once(reservation,"listening");
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  server=spawn(process.execPath,[path.join(root,"node_modules/next/dist/bin/next"),"start",fixture,"--hostname","127.0.0.1","--port",String(port)],
    {cwd:fixture,env,stdio:["ignore","pipe","pipe"]});
  server.on("error",error=>{output+=error.message;});
  for(const stream of [server.stdout,server.stderr])stream.on("data",data=>{output=(output+data).slice(-64000);});
  const origin=`http://127.0.0.1:${port}`;
  const request=async (route,jar=new Map(),options={})=>{
    const response=await fetch(origin+route,{...options,redirect:"manual",headers:{cookie:cookieHeader(jar),...options.headers},signal:AbortSignal.timeout(10000)});
    for(const cookie of response.headers.getSetCookie()) {
      const pair=cookie.split(";",1)[0];const value=pair.slice(pair.indexOf("=")+1);
      if(value.length>20)cookieCanaries.add(value);
    }
    const headers=new Headers(response.headers);headers.delete("set-cookie");assertClean(JSON.stringify([...headers]),"visible headers");
    const body=await response.clone().text();assertClean(body,"response body");return response;
  };
  let ready=false;
  for(let i=0;i<100;i++) {
    if(server.exitCode!==null)throw new Error(`Fixture exited: ${output}`);
    try{if((await request("/api/health")).status===200){ready=true;break;}}catch{/* Startup only. */}
    await delay(100);
  }
  assert.ok(ready,`Fixture not ready: ${output}`);
  const seed=async id=>{const jar=new Map();const response=await request("/api/seed",jar,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id})});
    assert.equal(response.status,200);for(const field of ["cdn-cache-control","netlify-cdn-cache-control"])assert.equal(response.headers.get(field),"no-store");absorb(response,jar);return jar;};
  const refreshCount=()=>auth.calls.filter(call=>call.grant==="refresh_token").length;
  const first=await seed("expired-large-a"), second=await seed("expired-b");
  const before=refreshCount();
  const responses=await Promise.all([request("/",first),request("/",second)]);
  for(const [index,response] of responses.entries()) {
    assert.equal(response.status,200);
    assert.ok((await response.text()).includes(`fictional-user:${index===0?"expired-large-a":"expired-b"}`));
    assert.equal(response.headers.get("cache-control"),"private, no-cache, no-store, must-revalidate, max-age=0");
    for(const field of ["cdn-cache-control","netlify-cdn-cache-control"])assert.equal(response.headers.get(field),"no-store");
    absorb(response,index===0?first:second);
  }
  assert.equal(first.size,1);assert.equal(second.size,1);assert.equal(refreshCount(),before+2);
  const after=refreshCount();
  for(const [route,options] of [["/",{}],["/",{headers:{RSC:"1"}}],["/dashboard/report.csv",{headers:{"next-router-prefetch":"1"}}]]) {
    let response=await request(route,first,options);
    if(options.headers?.RSC && response.status===307) {
      const destination=new URL(response.headers.get("location"),origin);
      assert.equal(destination.origin,origin);assert.ok(destination.searchParams.has("_rsc"));
      response=await request(destination.pathname+destination.search,first,options);
    }
    assert.equal(response.status,200,`${route}: ${response.headers.get("location")}`);
    assert.ok((await response.text()).includes("expired-large-a"));assert.ok(response.headers.get("cache-control").includes("private"));
  }
  assert.equal(refreshCount(),after);
  console.log("PASS: same-request refresh, following-request persistence, concurrent isolation, chunk replacement, HTML/RSC/prefetch");
  const redirectJar=await seed("expired-redirect");
  const redirect=await request("/fixture-redirect",redirectJar);
  assert.equal(redirect.status,303);assert.equal(new URL(redirect.headers.get("location"),origin).href,origin+"/");
  assert.equal(redirect.headers.get("pragma"),"no-cache");assert.ok(absorb(redirect,redirectJar).length>0);
  console.log("PASS: replacement redirect retains session cookies and cache protections");
  for(const id of ["rejected-expired","revoked-fresh"]) {
    const jar=await seed(id);jar.set(key+"-code-verifier","pending");jar.set("unrelated","keep");
    const response=await request("/api/private",jar);assert.equal(response.status,401);
    absorb(response,jar);assert.ok(!jar.has(key));assert.equal(jar.get(key+"-code-verifier"),"pending");assert.equal(jar.get("unrelated"),"keep");
  }
  const malformed=new Map([[key,"bad-session-json"],[key+"-code-verifier","pending"]]);
  const denied=await request("/api/private",malformed);assert.equal(denied.status,401);absorb(denied,malformed);assert.ok(!malformed.has(key));
  const anonymousBefore=auth.calls.length;
  for(const route of ["/auth/confirm","/api/health","/file.svg"])assert.equal((await request(route,malformed)).status,200);
  assert.equal(auth.calls.length,anonymousBefore);
  console.log("PASS: invalid sessions denied; scoped cleanup preserves PKCE; anonymous/public/asset traffic skips Auth");
  for(const id of ["unknown-expired","unknown-fresh","down-expired","rate-expired","socket-expired","malformed-expired","invalidpayload-expired","rotate-down-expired","hang-expired","body-expired"]) {
    const jar=await seed(id);const started=Date.now();const response=await request("/",jar);
    assert.equal(response.status,503,id);assert.ok(Date.now()-started<6500,id);
    assert.equal(await response.text(),"Authentication service unavailable.");
    assert.ok(response.headers.getSetCookie().every(value=>!/Max-Age=0(?:;|$)/i.test(value)),"Outage must not erase credentials");
    if(id.startsWith("rotate-down"))assert.ok(response.headers.getSetCookie().length>0);
    const count=auth.calls.length;await delay(250);assert.equal(auth.calls.length,count,"No detached SDK retry");
    for(const route of ["/api/health","/file.svg"])assert.equal((await request(route,jar)).status,200);
    assert.equal(auth.calls.length,count);
  }
  assertClean(output,"process output");assert.ok(!output.includes("unhandledRejection"));
  assert.ok(auth.calls.every(call=>["/auth/v1/user","/auth/v1/token"].includes(call.path)));
  console.log("PASS: real Auth outages/timeouts fail closed without secret leakage, destructive cleanup or detached retries");
} finally {
  if(server&&server.exitCode===null){server.kill();await once(server,"exit");}
  await auth.close();await rm(fixture,{recursive:true,force:true});
}
