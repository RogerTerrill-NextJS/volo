import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createClient} from '@supabase/supabase-js';
import {createCompletionAuthTransport,setInvitationPassword} from '../lib/auth/invitation-completion-auth.ts';
const subject='22000000-0000-4000-8000-000000000124',user={id:subject,aud:'authenticated',role:'authenticated',email:'member@example.invalid',email_confirmed_at:'2026-10-09',is_anonymous:false,app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:'2026-10-09'};
async function run(response:()=>Promise<Response>,expectedSubject=subject){
 const old=globalThis.fetch;let writes=0;globalThis.fetch=async(url,init)=>{assert.equal(init?.cache,'no-store');assert.equal(init?.redirect,'error');if(init?.method==='PUT'){writes++;assert.deepEqual(JSON.parse(String(init.body)),{password:'Password_canary124',code_challenge:null,code_challenge_method:null});return response();}return Response.json(user);};
 const transport=createCompletionAuthTransport();
 try{const client=createClient('https://example.supabase.co','fixture',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:transport.fetch}});await client.auth.setSession({access_token:'e30.'+Buffer.from(JSON.stringify({sub:subject,exp:Math.floor(Date.now()/1000)+600})).toString('base64url')+'.fixture',refresh_token:'fixture'});const result=await setInvitationPassword(client,'Password_canary124',expectedSubject,transport);return {result,writes};}finally{transport.close();globalThis.fetch=old;}
}
test('password mutation uses real SDK and accepts only complete matching confirmed provider user',async()=>{
 assert.deepEqual(await run(async()=>Response.json(user)),{result:{code:'updated'},writes:1});
 for(const data of [{...user,id:'other'},{...user,email_confirmed_at:null},{...user,is_anonymous:true},{id:subject},null])assert.deepEqual(await run(async()=>Response.json(data)),{result:{code:'unknown'},writes:1});
});
test('provider rejection is sanitized and outages cannot retry password mutation',async()=>{
 for(const code of ['weak_password','same_password'])assert.deepEqual(await run(async()=>Response.json({code,error_code:code,message:'provider_secret_canary'},{status:422})),{result:{code:'rejected'},writes:1});
 for(const status of [429,500,503])assert.deepEqual(await run(async()=>Response.json({message:'provider_secret_canary'},{status})),{result:{code:'unknown'},writes:1});
 assert.deepEqual(await run(async()=>new Response('malformed')),{result:{code:'unknown'},writes:1});
});
test('completion transport bounds response-body stalls and blocks subsequent network calls',async(t)=>{
 const old=globalThis.fetch;let calls=0;t.mock.timers.enable({apis:['setTimeout']});globalThis.fetch=async(_input,init)=>{calls++;return new Response(new ReadableStream({start(c){init?.signal?.addEventListener('abort',()=>c.error(new Error('secret_canary')));}}));};
 try{const transport=createCompletionAuthTransport(),pending=transport.fetch('https://example.supabase.co/auth/v1/user',{method:'PUT'});await Promise.resolve();t.mock.timers.tick(5001);const response=await pending;assert.equal(response.status,400);assert.equal(transport.isUnavailable(),true);assert.ok(!(await response.text()).includes('canary'));await transport.fetch('https://example.supabase.co/auth/v1/user',{method:'PUT'});assert.equal(calls,1);transport.close();}finally{globalThis.fetch=old;t.mock.timers.reset();}
});
