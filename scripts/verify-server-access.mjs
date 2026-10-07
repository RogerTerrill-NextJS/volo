import assert from "node:assert/strict";
import {execFile,spawn} from "node:child_process";
import {once} from "node:events";
import {cp,mkdir,mkdtemp,readFile,readdir,rm,symlink,writeFile} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import path from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {promisify} from "node:util";
import {startAccessFixture,accessKey,accessCanaries} from "../tests/helpers/access-fixture.mjs";

const root=path.resolve(import.meta.dirname,"..");
const fixture=await mkdtemp(path.join(tmpdir(),"volo-access-"));
const backend=await startAccessFixture();
const secretMarkers=new Set(accessCanaries);
let server,output="";
const clean=(value,label)=>{for(const marker of secretMarkers)assert.ok(!value.includes(marker),`Sensitive fixture marker in ${label}`);};
const put=async(name,content)=>{await mkdir(path.dirname(path.join(fixture,name)),{recursive:true});await writeFile(path.join(fixture,name),content);};
const membershipCalls=()=>backend.calls.filter(call=>call.service==="membership");
async function scan(directory){for(const entry of await readdir(directory,{withFileTypes:true})){
  const file=path.join(directory,entry.name);if(entry.isDirectory())await scan(file);else clean(await readFile(file,"utf8"),"browser assets");}}
try {
  const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NEXT_TELEMETRY_DISABLED:"1",
    NEXT_PUBLIC_SUPABASE_URL:backend.origin,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:accessKey};
  await symlink(path.join(root,"node_modules"),path.join(fixture,"node_modules"),"dir");
  await cp(path.join(root,"lib"),path.join(fixture,"lib"),{recursive:true});await cp(path.join(root,"tsconfig.json"),path.join(fixture,"tsconfig.json"));
  await put("package.json",JSON.stringify({private:true,type:"module"}));
  await put("next.config.mjs",`export default {outputFileTracingRoot:${JSON.stringify(fixture)}};`);
  await put("instrumentation.js",`export function register(){const original=globalThis.fetch;globalThis.fetch=(input,init)=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    if(url.origin!==${JSON.stringify(backend.origin)})throw new Error('Fixture forbids outbound requests');return original(input,init);};}`);
  await put("app/layout.jsx",'export default function Layout({children}){return <html><body>{children}</body></html>;}');
  await put("app/api/health/route.js",'export function GET(){return Response.json({ok:true});}');
  await put("app/api/access/route.js",`import {getAccess,requireActiveMember,requireRole,AccessError} from '../../../lib/auth/access';
    const headers={'cache-control':'private, no-store'};
    export async function GET(request){const mode=new URL(request.url).searchParams.get('mode');try{
      if(mode==='result'){const result=await getAccess();return Response.json(result,{headers});}
      const member=mode==='role'?await requireRole(JSON.parse(new URL(request.url).searchParams.get('roles'))):await requireActiveMember();
      return Response.json(member,{headers});
    }catch(error){if(!(error instanceof AccessError))throw error;
      return Response.json({code:error.code,message:error.message},{status:{unauthenticated:401,forbidden:403,unavailable:503}[error.code],headers});}}`);
  await put("app/page.jsx",`import {requireActiveMember,AccessError} from '../lib/auth/access';
    export default async function Page(){try{const first=await requireActiveMember();const second=await requireActiveMember();
      return <p>{'protected-access:'+first.userId+':'+second.role}</p>;}catch(error){if(!(error instanceof AccessError))throw error;return <p>{error.code}</p>;}}`);
  await promisify(execFile)(process.execPath,[path.join(root,"node_modules/next/dist/bin/next"),"build",fixture,"--webpack"],
    {cwd:fixture,env,maxBuffer:8*1024*1024,timeout:120000});
  await scan(path.join(fixture,".next/static"));
  const reservation=createServer();reservation.listen(0,"127.0.0.1");await once(reservation,"listening");
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  server=spawn(process.execPath,[path.join(root,"node_modules/next/dist/bin/next"),"start",fixture,"--hostname","127.0.0.1","--port",String(port)],
    {cwd:fixture,env,stdio:["ignore","pipe","pipe"]});
  server.on("error",error=>{output+=error.message;});
  for(const stream of [server.stdout,server.stderr])stream.on("data",data=>{output+=data.toString();});
  const origin=`http://127.0.0.1:${port}`;
  const request=async(jar=new Map(),route="/api/access",headers={})=>{
    const response=await fetch(origin+route,{redirect:"manual",headers:{cookie:[...jar].map(([name,value])=>`${name}=${value}`).join("; "),...headers},signal:AbortSignal.timeout(12000)});
    assert.equal(response.headers.getSetCookie().length,0,"Guards must not persist cookies");
    clean(JSON.stringify([...response.headers]),"headers");clean(await response.clone().text(),"body");return response;};
  let ready=false;for(let i=0;i<100;i++){
    if(server.exitCode!==null)throw new Error("Fixture server exited");
    try{if((await request(new Map(),"/api/health")).status===200){ready=true;break;}}catch{/* Startup. */}await delay(100);
  }assert.ok(ready,"Fixture server starts");
  const seed=async(label,options)=>{const value=await backend.seed(label,options);for(const token of value.jar.values())secretMarkers.add(token);return value;};
  const member=await seed("member"),admin=await seed("admin",{role:"admin"});
  const before=membershipCalls().length;
  for(const jar of [new Map(),new Map([["sb-127-auth-token","invalid-json"]])])assert.equal((await request(jar)).status,401);
  const forged=new Map(member.jar);const pair=[...forged][0];
  const session=JSON.parse(Buffer.from(pair[1].slice("base64-".length),"base64url"));session.access_token+="-forged";session.user.id=admin.entry.id;
  forged.set(pair[0],"base64-"+Buffer.from(JSON.stringify(session)).toString("base64url"));secretMarkers.add(forged.get(pair[0]));
  assert.equal((await request(forged)).status,401);assert.equal(membershipCalls().length,before);
  for(const account of [member,admin]){
    const response=await request(account.jar);assert.equal(response.status,200);assert.deepEqual(await response.json(),{userId:account.entry.id,role:account.entry.role});
  }
  const result=await request(member.jar,"/api/access?mode=result");assert.deepEqual(await result.json(),{status:"authorized",member:{userId:member.entry.id,role:"member"}});
  for(const options of [{membership:"absent"},{status:"disabled"},{auth:"rejected"}]){
    const account=await seed("denied"+backend.cases.size,options);assert.equal((await request(account.jar)).status,options.auth?401:403);
  }
  const role=async(account,roles)=>request(account.jar,"/api/access?mode=role&roles="+encodeURIComponent(JSON.stringify(roles)));
  assert.equal((await role(member,["admin"])).status,403);assert.equal((await role(admin,["admin"])).status,200);
  assert.equal((await role(admin,["member"])).status,403);
  for(const roles of [[],["owner"],["member","owner"],null,"admin",{role:"admin"}])assert.equal((await role(member,roles)).status,403);
  assert.equal((await role({jar:new Map()},[])).status,401);
  console.log("PASS: verified identities, safe results, membership admission, metadata spoofing and explicit roles");
  member.entry.status="disabled";assert.equal((await request(member.jar)).status,403);
  member.entry.status="active";member.entry.role="admin";assert.equal((await role(member,["admin"])).status,200);
  member.entry.role="member";assert.equal((await role(member,["admin"])).status,403);
  const concurrent=await Promise.all([request(member.jar),request(admin.jar)]);
  assert.deepEqual(await concurrent[0].json(),{userId:member.entry.id,role:"member"});assert.deepEqual(await concurrent[1].json(),{userId:admin.entry.id,role:"admin"});
  const count=membershipCalls().length;const page=await request(member.jar,"/");assert.ok((await page.text()).includes("protected-access:"+member.entry.id));assert.equal(membershipCalls().length,count+2);
  let rsc=await request(member.jar,"/",{RSC:"1"});
  if(rsc.status===307){const target=new URL(rsc.headers.get("location"),origin);assert.equal(target.origin,origin);
    rsc=await request(member.jar,target.pathname+target.search,{RSC:"1"});}
  assert.equal(rsc.status,200);assert.match(rsc.headers.get("content-type"),/text\/x-component/);
  assert.ok((await rsc.text()).includes("protected-access:"+member.entry.id));
  for(const call of membershipCalls()){assert.equal(call.method,"GET");assert.equal(call.select,"user_id,role,status");assert.equal(call.filter,`eq.${call.subject}`);}
  const changed=await seed("different-verified-subject",{verifiedId:admin.entry.id});
  assert.equal((await request(changed.jar)).status,403);assert.equal(membershipCalls().at(-1).filter,`eq.${admin.entry.id}`);
  console.log("PASS: fresh membership/role changes, repeated render checks, concurrent isolation and verified subject filtering");
  for(const options of [{membership:"null-row"},{rowId:admin.entry.id},{role:"owner"},{status:"unknown"},{membership:"duplicate"},{membership:"invalid"},{membership:"null"},{verifiedId:"not-a-uuid"},{auth:"invalid"}]){
    const account=await seed("invalid"+backend.cases.size,options);assert.equal((await request(account.jar)).status,503,JSON.stringify(options));
  }
  for(const service of ["auth","membership"]){
    for(const mode of ["unknown","rate","down","denied","socket","malformed","hang","body"]){
      const account=await seed(`${service}-${mode}`,{[service]:mode});const start=Date.now();
      const response=await request(account.jar);assert.equal(response.status,503,`${service}/${mode}`);
      assert.deepEqual(await response.json(),{code:"unavailable",message:"Access service unavailable."});
      assert.ok(Date.now()-start<6500,`${service}/${mode} is bounded`);
      const calls=backend.calls.length;await delay(100);assert.equal(backend.calls.length,calls,"No detached retries");
    }
  }
  const expired=await seed("expired",{expired:true});const beforeExpired=membershipCalls().length;
  assert.equal((await request(expired.jar)).status,503);assert.equal(membershipCalls().length,beforeExpired);
  const failedResult=await request(expired.jar,"/api/access?mode=result");assert.deepEqual(await failedResult.json(),{status:"unavailable"});
  const deniedPage=await request(new Map(),"/");assert.ok(!(await deniedPage.text()).includes("protected-access:"));
  const downRole=await seed("role-service-failure",{membership:"down"});assert.equal((await role(downRole,[])).status,503);
  clean(output,"process output");assert.ok(!output.includes("unhandledRejection"));assert.deepEqual(backend.unexpected,[]);
  await scan(path.join(fixture,".next/static"));
  console.log("PASS: malformed/failed services, direct expired sessions, bounded headers/bodies and no credential leaks or writes");
} finally {
  if(server&&server.exitCode===null){server.kill();await once(server,"exit");}
  await backend.close();await rm(fixture,{recursive:true,force:true});
}
