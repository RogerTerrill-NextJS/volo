import assert from "node:assert/strict";
import {execFile,spawn} from "node:child_process";
import {once} from "node:events";
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {tmpdir} from "node:os";
import path from "node:path";
import {promisify} from "node:util";
import {setTimeout as delay} from "node:timers/promises";
import {startAccessFixture,accessKey,accessCanaries} from "./access-fixture.mjs";

export async function startCacheFixture() {
  const root=path.resolve(import.meta.dirname,"../..");
  const directory=await mkdtemp(path.join(tmpdir(),"volo-cache-"));
  let backend,server,control,output="";
  const canaries=new Set(accessCanaries);
  const clean=value=>{for(const marker of canaries)assert.ok(!value.includes(marker),"Cache fixture leaked credential/error marker");};
  const put=async(name,value)=>{const file=path.join(directory,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,value);};
  const close=async()=>{
    if(server && server.exitCode===null){server.kill();await once(server,"exit");}
    if(control?.listening){control.closeAllConnections();await new Promise(resolve=>control.close(resolve));}
    if(backend)await backend.close();
    await rm(directory,{recursive:true,force:true});
  };
  try {
    backend=await startAccessFixture();
    const seed=async(label,options)=>{const account=await backend.seed(label,options);for(const value of account.jar.values())canaries.add(value);return account;};
    const accounts={A:await seed("cache-a"),B:await seed("cache-b")};
    // Owned loopback browser controls only. Never copied into the product app.
    control=createServer((req,res)=>{
      const url=new URL(req.url,"http://fixture.invalid");
      let result;
      if(url.pathname==="/state")result={auth:backend.calls.filter(x=>x.service==="auth").length,membership:backend.calls.filter(x=>x.service==="membership").length,A:accounts.A.entry.status};
      else if(url.pathname==="/membership"){accounts.A.entry.status=url.searchParams.get("status")==="disabled"?"disabled":"active";result={ok:true};}
      else if(url.pathname==="/session")result=[...(accounts[url.searchParams.get("who")]?.jar??[])];
      else {res.writeHead(404).end();return;}
      res.setHeader("content-type","application/json");res.setHeader("cache-control","no-store");res.end(JSON.stringify(result));
    });
    control.listen(0,"127.0.0.1");await once(control,"listening");
    const controlOrigin=`http://127.0.0.1:${control.address().port}`;
    const reservation=createServer();reservation.listen(0,"127.0.0.1");await once(reservation,"listening");
    const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
    const origin=`http://127.0.0.1:${port}`;
    const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NEXT_TELEMETRY_DISABLED:"1",NEXT_PUBLIC_SUPABASE_URL:backend.origin,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:accessKey,VOLO_MUTATION_ORIGIN:origin};
    await symlink(path.join(root,"node_modules"),path.join(directory,"node_modules"),"dir");
    for(const name of ["lib","app","proxy.ts","tsconfig.json","next.config.ts"])await cp(path.join(root,name),path.join(directory,name),{recursive:true});
    await put("package.json",JSON.stringify({private:true,type:"module"}));
    await put("app/layout.tsx","export default function Layout({children}:{children:React.ReactNode}){return <html><body>{children}</body></html>}");
    await put("app/page.tsx",'import Link from "next/link"; export default function Page(){return <main><h1>Public cache fixture</h1><Link href="/dashboard/cache-check" prefetch={false}>Private page</Link><br/><Link href="/fixture-controls" prefetch={false}>Fixture controls</Link></main>}');
    await put("app/(protected)/dashboard/cache-check/page.tsx",`import Link from 'next/link';import {getPageAccess} from '../../../../lib/auth/page-access';import AccessState from '../../_components/access-state';
      export default async function Page(){const access=await getPageAccess();if(access.status!=='authorized')return <AccessState status={access.status}/>;
      return <main><p>{'subject:'+access.member.userId}</p><Link href='/' prefetch={false}>Public page</Link><br/><Link href='/fixture-controls' prefetch={false}>Fixture controls</Link></main>;}`);
    await put("app/api/cache-check/route.ts",`import {getAccess} from '../../../lib/auth/access';import {applyPrivateResponseHeaders} from '../../../lib/http/private-response';
      export async function GET(){const access=await getAccess(),headers=new Headers();applyPrivateResponseHeaders(headers);
      return Response.json(access.status==='authorized'?{subject:access.member.userId}:{status:access.status},{headers,status:access.status==='authorized'?200:access.status==='unauthenticated'?401:access.status==='forbidden'?403:503});}`);
    await put("app/cache-public/route.ts","export function GET(){return new Response('public control',{headers:{'Cache-Control':'public, max-age=600','Netlify-CDN-Cache-Control':'public, max-age=600'}})}");
    await put("app/fixture-controls/page.tsx",`import Link from 'next/link';export const dynamic='force-dynamic';export default async function Page(){
      const state=await (await fetch(${JSON.stringify(controlOrigin+"/state")},{cache:'no-store'})).json();
      return <main><h1>Fictional cache controls</h1><pre>{JSON.stringify(state)}</pre><a href='/fixture-session?who=A'>Sign in A</a><br/><a href='/fixture-session?who=B'>Sign in B</a><br/><a href='/fixture-session?who=none'>Sign out</a><br/><a href='/fixture-membership?status=disabled'>Disable A</a><br/><a href='/fixture-membership?status=active'>Reactivate A</a><br/><Link href='/' prefetch={false}>Public page</Link><br/><Link href='/dashboard/cache-check' prefetch={false}>Private page</Link></main>;}`);
    await put("app/fixture-session/route.ts",`import {NextResponse} from 'next/server';import {cookies} from 'next/headers';import {applyPrivateResponseHeaders} from '../../lib/http/private-response';
      export async function GET(request:Request){const who=new URL(request.url).searchParams.get('who'),response=NextResponse.redirect(new URL(who==='none'?'/fixture-controls':'/dashboard/cache-check',${JSON.stringify(origin)}),303);
      for(const cookie of (await cookies()).getAll())if(cookie.name==='sb-127-auth-token'||/^sb-127-auth-token\\.\\d+$/.test(cookie.name))response.cookies.set(cookie.name,'',{path:'/',maxAge:0});
      const pairs=await (await fetch(${JSON.stringify(controlOrigin+"/session")}+'?who='+encodeURIComponent(who??''),{cache:'no-store'})).json();
      for(const [name,value] of pairs)response.cookies.set(name,value,{path:'/',sameSite:'lax',httpOnly:true});applyPrivateResponseHeaders(response.headers);return response;}`);
    await put("app/fixture-membership/route.ts",`import {NextResponse} from 'next/server';export async function GET(request:Request){const status=new URL(request.url).searchParams.get('status');await fetch(${JSON.stringify(controlOrigin+"/membership")}+'?status='+encodeURIComponent(status??''),{cache:'no-store'});return NextResponse.redirect(new URL('/fixture-controls',${JSON.stringify(origin)}),303);}`);
    await put("instrumentation.js",`export function register(){const original=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!${JSON.stringify([backend.origin,controlOrigin])}.includes(url.origin))throw new Error('Fixture forbids outbound requests');return original(input,init);};}`);
    const build=await promisify(execFile)(process.execPath,[path.join(root,"node_modules/next/dist/bin/next"),"build",directory,"--webpack"],{cwd:directory,env,maxBuffer:8*1024*1024,timeout:120000});clean(build.stdout+build.stderr);
    server=spawn(process.execPath,[path.join(root,"node_modules/next/dist/bin/next"),"start",directory,"--hostname","127.0.0.1","--port",String(port)],{cwd:directory,env,stdio:["ignore","pipe","pipe"]});
    server.on("error",error=>{output+=error.message;});for(const stream of [server.stdout,server.stderr])stream.on("data",data=>{output=(output+data).slice(-64000);});
    const request=async(route,jar=new Map(),headers={})=>{
      for(let attempt=0;attempt<3;attempt++){
        const response=await fetch(origin+route,{redirect:"manual",headers:{Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join("; "),...headers},signal:AbortSignal.timeout(15000)});
        for(const value of response.headers.getSetCookie()){const pair=value.split(";",1)[0];const token=pair.slice(pair.indexOf("=")+1);if(token.length>20)canaries.add(token);}
        const body=await response.text(),visible=new Headers(response.headers);visible.delete("set-cookie");clean(body);clean(JSON.stringify([...visible]));
        if(headers.RSC && response.status===307){const target=new URL(response.headers.get("location"),origin);assert.equal(target.origin,origin);
          if(target.pathname===new URL(origin+route).pathname && target.searchParams.has("_rsc")){
            for(const field of ["cdn-cache-control","netlify-cdn-cache-control"])assert.equal(response.headers.get(field),"no-store");
            route=target.pathname+target.search;continue;
          }
        }
        return {status:response.status,headers:new Headers(response.headers),body};
      }
      throw new Error("Too many RSC redirects");
    };
    let ready=false;for(let i=0;i<100;i++){if(server.exitCode!==null)throw new Error("Cache fixture exited");try{if((await request("/api/health")).status===200){ready=true;break;}}catch{}await delay(100);}
    assert.ok(ready,"Cache fixture ready");
    return {origin,directory,backend,accounts,request,seed,clean,close,get output(){return output;}};
  }catch(error){await close();throw error;}
}
