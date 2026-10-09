import {execFile,spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {promisify} from 'node:util';
import {reservePort,validateLocalApiUrl,sanitizeDiagnostics,evidenceDirectory} from './local-auth-stack.mjs';

const decode=value=>value.replaceAll('&quot;','"').replaceAll('&#x27;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
export async function startRealAuthApp({repositoryRoot:root,stack,signal,applicationOrigin}) {
  validateLocalApiUrl(stack.apiUrl,Number(new URL(stack.apiUrl).port));
  const directory=await mkdtemp(path.join(tmpdir(),'volo-real-auth-app-'));const effects=[];let server,recorder,output='',closePromise,fixtureStage='files';
  const put=async(name,value)=>{const file=path.join(directory,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,value);};
  const close=()=>closePromise??=(async()=>{
    if(server&&server.exitCode===null){server.kill();await Promise.race([once(server,'exit'),delay(5000).then(()=>{if(server.exitCode===null)server.kill('SIGKILL');})]);}
    if(recorder?.listening){recorder.closeAllConnections();await new Promise(resolve=>recorder.close(resolve));}
    await rm(directory,{recursive:true,force:true});
  })();
  try {
    signal?.throwIfAborted();
    recorder=createServer(async(req,res)=>{try{let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)throw new Error();}const data=JSON.parse(body);if(!/^[a-f0-9-]{36}$/i.test(data.userId))throw new Error();effects.push({userId:data.userId});res.end('{}');}catch{res.statusCode=400;res.end();}});
    recorder.listen(0,'127.0.0.1');await once(recorder,'listening');const recordOrigin=`http://127.0.0.1:${recorder.address().port}`;
    const port=applicationOrigin?Number(new URL(applicationOrigin).port):await reservePort(),origin=`http://127.0.0.1:${port}`;
    if(applicationOrigin&&origin!==applicationOrigin)throw new Error('Invalid owned application origin');
    const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:stack.apiUrl,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:stack.publicKey,VOLO_MUTATION_ORIGIN:origin,SUPABASE_SECRET_KEY:stack.serverSecret};
    await symlink(path.join(root,'node_modules'),path.join(directory,'node_modules'),'dir');
    for(const name of ['lib','proxy.ts','tsconfig.json','next.config.ts'])await cp(path.join(root,name),path.join(directory,name),{recursive:true});
    await cp(path.join(root,'app/(protected)/layout.tsx'),path.join(directory,'protected-layout.tsx'));
    await put('package.json',JSON.stringify({private:true,type:'module'}));
    await put('instrumentation.js',`export function register(){const original=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!${JSON.stringify([stack.apiUrl,recordOrigin])}.includes(url.origin)||url.username||url.password)throw new Error('Fixture forbids outbound requests');return original(input,{...init,redirect:'error'});};}`);
    await put('app/layout.tsx','export default function Layout({children}:{children:React.ReactNode}){return <html><body>{children}</body></html>}');
    await put('app/page.tsx','export default function Page(){return <p>Public fixture</p>}');
    await put('app/login/page.tsx','export default function Page(){return <p>Sign in</p>}');
    await put('app/dashboard/layout.tsx',"export {default,dynamic} from '../../protected-layout';");
    await put('app/dashboard/page.tsx',`import {mutate,adminMutate} from '../actions';import Form from '../form';import {getPageAccess} from '../../lib/auth/page-access';export default async function Page(){const access=await getPageAccess();if(access.status!=='authorized')return <p>Access denied</p>;return <main><p>subject:{access.member.userId} role:{access.member.role}</p><Form action={mutate} label="Write"/><Form action={adminMutate} label="Admin"/></main>;}`);
    await put('app/api/subject/route.ts',`import {getAccess} from '../../../lib/auth/access';import {applyPrivateResponseHeaders} from '../../../lib/http/private-response';export async function GET(){const access=await getAccess();const headers=new Headers();applyPrivateResponseHeaders(headers);return Response.json(access.status==='authorized'?{userId:access.member.userId,role:access.member.role}:{status:access.status},{headers,status:access.status==='authorized'?200:access.status==='unauthenticated'?401:access.status==='forbidden'?403:503});}`);
    await put('fixture-policy.ts',`import type {MutationPolicy} from './lib/auth/mutation';export function policy(admin=false):MutationPolicy<{value:string},{saved:boolean}>{return {allowedRoles:admin?['admin']:['member','admin'],parse(raw){return raw&&typeof raw==='object'&&'value' in raw&&raw.value==='valid'?{ok:true,value:{value:'valid'}}:{ok:false};},authorize(){return true;},async effect(member){const response=await fetch(${JSON.stringify(recordOrigin+'/effect')},{method:'POST',body:JSON.stringify({userId:member.userId}),cache:'no-store'});if(!response.ok)throw new Error('Recorder rejected effect');return {saved:true};}};}`);
    await put('app/api/invitations/route.ts',`import {handleRouteMutation} from '../../../lib/auth/route-mutation';import {invitationIssuancePolicy} from '../../../lib/auth/invitation-issuance';export function POST(request:Request){return handleRouteMutation(request,{method:'POST',policy:invitationIssuancePolicy()});}`);
    await put('app/api/invitation-race/route.ts',`import {randomUUID} from 'node:crypto';import {handleRouteMutation} from '../../../lib/auth/route-mutation';import {invitationIssuancePolicy} from '../../../lib/auth/invitation-issuance';import {executeInitialInvitation} from '../../../lib/auth/invitation-send';import {createInitialSendPorts} from '../../../lib/auth/invitation-send-provider';export function POST(request:Request){const policy=invitationIssuancePolicy();policy.effect=async(member,input)=>{const ports=createInitialSendPorts();const create=ports.createSubject;ports.createSubject=async(id,email)=>{const competing=await create(randomUUID(),email);if(competing.code!=='accepted')throw new Error('Owned race fixture failed');return create(id,email);};return executeInitialInvitation({operationId:randomUUID(),recipientEmail:input.email,requesterId:member.userId},ports);};return handleRouteMutation(request,{method:'POST',policy});}`);
    await put('app/api/write/route.ts',`import {handleRouteMutation} from '../../../lib/auth/route-mutation';import {policy} from '../../../fixture-policy';export function POST(request:Request){return handleRouteMutation(request,{method:'POST',policy:policy(new URL(request.url).searchParams.has('admin'))});}`);
    await put('app/actions.ts',`'use server';import {handleActionMutation} from '../lib/auth/action-mutation';import {policy} from '../fixture-policy';export async function mutate(_previous:unknown,form:FormData){return handleActionMutation(form,policy());}export async function adminMutate(_previous:unknown,form:FormData){return handleActionMutation(form,policy(true));}`);
    await put('app/form.tsx',`'use client';import {useActionState} from 'react';export default function Form({action,label}:{action:(previous:unknown,form:FormData)=>Promise<unknown>;label:string}){const [state,submit]=useActionState(action,null);return <form action={submit}><input name="value" defaultValue="valid"/><button>{label}</button><output>{JSON.stringify(state)}</output></form>;}`);
    await put('app/forms/page.tsx',`import {mutate,adminMutate} from '../actions';import Form from '../form';export default function Page(){return <main><Form action={mutate} label="Write"/><Form action={adminMutate} label="Admin"/></main>}`);
    fixtureStage='build';const build=await promisify(execFile)(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'build',directory,'--webpack'],{cwd:directory,env,signal,timeout:180000,maxBuffer:8*1024*1024});output+=build.stdout+build.stderr;signal?.throwIfAborted();
    fixtureStage='start';server=spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'start',directory,'--hostname','127.0.0.1','--port',String(port)],{cwd:directory,env,stdio:['ignore','pipe','pipe']});
    let startError;server.on('error',()=>{startError=true;});for(const stream of [server.stdout,server.stderr])stream.on('data',data=>{output=(output+data).slice(-4*1024*1024);});
    let ready=false;for(let i=0;i<100;i++){signal?.throwIfAborted();if(startError||server.exitCode!==null)throw new Error();try{const response=await fetch(origin,{signal:AbortSignal.timeout(1000)});await response.text();if(response.status===200){ready=true;break;}}catch{}await delay(100);}if(!ready)throw new Error();
    const request=async(route,{session,method='GET',headers:additional={},body}={})=>{
      const destination=new URL(route,origin);if(destination.origin!==origin)throw new Error('Fixture request must stay local');
      const headers=new Headers(additional);if(session)headers.set('Cookie',session.cookieHeader());
      const response=await fetch(destination,{method,headers,body,redirect:'manual',signal:AbortSignal.any([AbortSignal.timeout(15000),...(signal?[signal]:[])])});session?.applyResponse(response);return response;
    };
    fixtureStage='action-metadata';const html=await (await request('/forms')).text();
    const forms=[...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(match=>[...match[1].matchAll(/<input\b[^>]*>/g)].flatMap(input=>{const name=input[0].match(/name="(\$ACTION_[^"]+)"/)?.[1];return name?[[decode(name),decode(input[0].match(/value="([^"]*)"/)?.[1]??'')]]:[];}));
    const ids=forms.map(entries=>JSON.parse(entries.find(([name])=>name.endsWith(':0'))[1]).id);if(ids.length!==2)throw new Error();
    const {encodeReply}=createRequire(import.meta.url)('next/dist/compiled/react-server-dom-webpack/client.node.js');
    return {origin,request,close,effects:()=>effects.slice(),diagnostics:()=>output,
      async scanStatic(check){async function scan(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await scan(file);else check(await readFile(file,'utf8'));}}await scan(path.join(directory,'.next/static'));},
      async mutate(transport,{session,origin:requestOrigin=origin,admin=false}={}) {
        const headers=new Headers();if(requestOrigin!==null)headers.set('Origin',requestOrigin);
        if(transport==='json'){headers.set('content-type','application/json');return request('/api/write'+(admin?'?admin':''),{session,method:'POST',headers,body:JSON.stringify({value:'valid'})});}
        const form=new FormData();form.set('value','valid');let body;const index=admin?1:0;
        if(transport==='fetched'){body=await encodeReply([null,form]);headers.set('Accept','text/x-component');headers.set('Next-Action',ids[index]);}
        else if(transport==='native'){body=new FormData();for(const [key,value] of forms[index])body.append(key,value);body.set('value','valid');}
        else throw new Error('Unknown mutation transport');
        return request('/dashboard',{session,method:'POST',headers,body});
      },
    };
  }catch(error){
    const diagnostic=sanitizeDiagnostics(`Fixture stage: ${fixtureStage}\n${error.message}\n`+output+(error.stdout??'')+(error.stderr??''),[stack.publicKey,stack.serverSecret]);
    await mkdir(evidenceDirectory(root),{recursive:true});await writeFile(path.join(evidenceDirectory(root),'fixture-diagnostic.log'),diagnostic,{mode:0o600});
    await close();const failure=new Error('Real Auth Next fixture build/start failed; raw child output withheld');failure.fixtureDiagnostic=diagnostic.slice(-6000);throw failure;
  }
}
