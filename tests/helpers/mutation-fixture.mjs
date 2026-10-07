import assert from "node:assert/strict";
import {execFile,spawn} from "node:child_process";
import {once} from "node:events";
import {cp,mkdir,mkdtemp,readFile,rm,symlink,writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {tmpdir} from "node:os";
import path from "node:path";
import {promisify} from "node:util";
import {setTimeout as delay} from "node:timers/promises";
import {startAccessFixture,accessKey,accessCanaries} from "./access-fixture.mjs";

export async function startMutationFixture({actions=false}={}) {
  const root=path.resolve(import.meta.dirname,"../..");
  const directory=await mkdtemp(path.join(tmpdir(),"volo-mutations-"));
  const backend=await startAccessFixture();const effects=[],bare=[];
  const canaries=new Set([...accessCanaries,"mutation-error-canary"]);
  const recorder=createServer(async(req,res)=>{
    let body="";for await(const chunk of req)body+=chunk;
    const data=JSON.parse(body);(req.url==="/effect"?effects:bare).push(data);
    res.setHeader("content-type","application/json");res.end('{"saved":true}');
  });
  recorder.listen(0,"127.0.0.1");await once(recorder,"listening");
  const recordOrigin=`http://127.0.0.1:${recorder.address().port}`;
  const reservation=createServer();reservation.listen(0,"127.0.0.1");await once(reservation,"listening");
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const origin=`http://127.0.0.1:${port}`;
  const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NEXT_TELEMETRY_DISABLED:"1",
    NEXT_PUBLIC_SUPABASE_URL:backend.origin,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:accessKey,VOLO_MUTATION_ORIGIN:origin};
  let server,output="";
  const clean=(value)=>{for(const marker of canaries)assert.ok(!value.includes(marker),"Mutation fixture leaked a private marker");};
  const put=async(name,value)=>{const file=path.join(directory,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,value);};
  const stop=async()=>{if(server && server.exitCode===null){server.kill();await once(server,"exit");}};
  const close=async()=>{await stop();recorder.closeAllConnections();await new Promise(resolve=>recorder.close(resolve));await backend.close();await rm(directory,{recursive:true,force:true});};
  try {
    await symlink(path.join(root,"node_modules"),path.join(directory,"node_modules"),"dir");
    for(const name of ["lib","proxy.ts","tsconfig.json","next.config.ts"])await cp(path.join(root,name),path.join(directory,name),{recursive:true});
    await put("package.json",JSON.stringify({private:true,type:"module"}));
    await put("app/layout.tsx","export default function Layout({children}:{children:React.ReactNode}){return <html><body>{children}</body></html>}");
    await put("app/page.tsx","export default function Page(){return <p>Mutation fixture ready</p>}");
    await put("proxy.ts",`import {refreshSupabaseSession} from './lib/supabase/proxy';import type {NextRequest} from 'next/server';
      export async function proxy(request:NextRequest){return (await refreshSupabaseSession(request)).response;}
      export const config={matcher:['/((?!api/no-proxy-write).*)']};`);
    await put("instrumentation.js",`export function register(){const original=globalThis.fetch;globalThis.fetch=(input,init)=>{
      const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
      if(!${JSON.stringify([backend.origin,recordOrigin])}.includes(url.origin))throw new Error('Fixture forbids outbound requests');return original(input,init);};}`);
    await put("fixture-policy.ts",`import type {MutationPolicy} from './lib/auth/mutation';
      type Input={value:string;mode?:string};
      export function policy(admin=false):MutationPolicy<Input,{saved:boolean}>{return {
        allowedRoles:admin?['admin']:['member','admin'],
        parse(raw){if(raw && typeof raw==='object' && 'mode' in raw && raw.mode==='parse-throw')throw new Error('mutation-error-canary');
          if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['value','mode'].includes(k)))return {ok:false};
          const value=(raw as Input).value,mode=(raw as Input).mode;
          return typeof value==='string'&&value.length>0&&value.length<=40000&&(mode===undefined||typeof mode==='string')?{ok:true,value:{value,mode}}:{ok:false};},
        authorize(_member,input){if(input.mode==='authorize-throw')throw new Error('mutation-error-canary');if(input.value==='truthy-resource')return 'yes' as unknown as boolean;return input.value!=='forbidden-resource';},
        async effect(member,input){if(input.mode==='effect-throw')throw new Error('mutation-error-canary');
          await fetch(${JSON.stringify(recordOrigin+"/effect")},{method:'POST',body:JSON.stringify({userId:member.userId,role:member.role,input}),cache:'no-store'});
          if(input.mode==='partial-throw')throw new Error('mutation-error-canary');return {saved:true};}
      };}`);
    await put("app/api/write/route.ts",`import {handleRouteMutation} from '../../../lib/auth/route-mutation';import {policy} from '../../../fixture-policy';
      const handle=(request:Request)=>{const query=new URL(request.url).searchParams;const selected=policy(query.has('admin'));
        if(query.has('empty-policy'))selected.allowedRoles=[];if(query.has('invalid-role'))Reflect.set(selected,'allowedRoles',['owner']);
        if(query.has('missing-permission'))Reflect.deleteProperty(selected,'authorize');
        return handleRouteMutation(request,{method:'POST',policy:selected});};
      export {handle as POST,handle as GET,handle as HEAD,handle as OPTIONS,handle as PUT,handle as PATCH,handle as DELETE};`);
    await put("app/api/no-proxy-write/route.ts",await readFile(path.join(directory,"app/api/write/route.ts"),"utf8"));
    if(actions)await put("app/actions.ts",`'use server';import {handleActionMutation} from '../lib/auth/action-mutation';import {policy} from '../fixture-policy';
      export async function mutate(_previous:unknown,form:FormData){return handleActionMutation(form,policy());}
      export async function adminMutate(_previous:unknown,form:FormData){return handleActionMutation(form,policy(true));}
      export async function bareAction(){await fetch(${JSON.stringify(recordOrigin+"/bare")},{method:'POST',body:'{}'});return {bare:true};}`);
    if(actions)await put("app/form.tsx",`'use client';import {useActionState} from 'react';
      export default function FixtureForm({action,label}:{action:(previous:unknown,form:FormData)=>Promise<unknown>;label:string}){
        const [state,submit]=useActionState(action,null);return <form action={submit}><input name="value" defaultValue="valid"/><button>{label}</button><output>{JSON.stringify(state)}</output></form>;}`);
    if(actions)await put("app/page.tsx",`import {mutate,adminMutate,bareAction} from './actions';import FixtureForm from './form';export default function Page(){return <main><FixtureForm action={mutate} label="Write"/><FixtureForm action={adminMutate} label="Admin"/><FixtureForm action={bareAction} label="Bare"/></main>}`);
    const build=await promisify(execFile)(process.execPath,[path.join(root,"node_modules/next/dist/bin/next"),"build",directory,"--webpack"],{cwd:directory,env,timeout:120000,maxBuffer:8*1024*1024});
    clean(build.stdout+build.stderr);
    const start=async(override={})=>{
      await stop();server=spawn(process.execPath,[path.join(root,"node_modules/next/dist/bin/next"),"start",directory,"--hostname","127.0.0.1","--port",String(port)],{cwd:directory,env:{...env,...override},stdio:["ignore","pipe","pipe"]});
      server.on("error",error=>{output+=error.message;});for(const stream of [server.stdout,server.stderr])stream.on("data",data=>{output+=data;});
      for(let i=0;i<100;i++){if(server.exitCode!==null)throw new Error("Mutation server exited");try{const r=await fetch(origin,{signal:AbortSignal.timeout(1000)});if(r.status===200)return;}catch{}await delay(100);}
      throw new Error("Mutation server did not start");
    };
    await start();
    const seed=async(label,options)=>{const account=await backend.seed(label,options);for(const value of account.jar.values())canaries.add(value);return account;};
    const request=async(route,jar=new Map(),init={})=>{
      const headers=new Headers({Origin:origin,Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join("; ")});
      for(const [key,value] of Object.entries(init.headers??{})){if(value===null)headers.delete(key);else headers.set(key,value);}
      const response=await fetch(origin+route,{redirect:"manual",signal:AbortSignal.timeout(10000),...init,headers});
      const body=await response.text();clean(body);const visible=new Headers(response.headers);visible.delete("set-cookie");clean(JSON.stringify([...visible]));
      return {response,body};
    };
    return {directory,origin,backend,effects,bare,seed,request,start,clean,put,get output(){return output;},close};
  }catch(error){await close();throw error;}
}
