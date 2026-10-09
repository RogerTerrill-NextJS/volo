import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {verifyConfirmationSession} from '../lib/auth/invitation-confirmation-auth.ts';
const subject='22000000-0000-4000-8000-000000000001',session='55000000-0000-4000-8000-000000000001';
test('setup binding requires verified claims and a matching fresh provider user',async()=>{
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='sb_publishable_fixture';
 const claims={sub:subject,session_id:session,iss:'https://example.supabase.co/auth/v1',aud:'authenticated',exp:Math.floor(Date.now()/1000)+60,is_anonymous:false};
 const user={id:subject,email:'Person@example.invalid',is_anonymous:false,email_confirmed_at:'2026-01-01'};
 const client=(changes:object={},userChanges:object={},error=false)=>({auth:{async getClaims(){return {data:{claims:{...claims,...changes}},error:error?new Error('provider_secret_canary'):null};},async getUser(){return {data:{user:{...user,...userChanges}},error:null};}}} as unknown as SupabaseClient);
 assert.deepEqual(await verifyConfirmationSession(client(),'verified-token'),{code:'verified',identity:{subject,email:'Person@example.invalid',sessionId:session}});
 for(const changes of [{session_id:undefined},{sub:'wrong'},{iss:'https://foreign.invalid/auth/v1'},{aud:'anon'},{exp:1},{is_anonymous:true}])assert.deepEqual(await verifyConfirmationSession(client(changes),'token'),{code:'denied'});
 for(const changes of [{id:'other'},{email:null},{is_anonymous:true},{email_confirmed_at:null}])assert.deepEqual(await verifyConfirmationSession(client({},changes),'token'),{code:'denied'});
 assert.deepEqual(await verifyConfirmationSession(client({}, {},true),'token'),{code:'denied'});
});

test('confirmation Auth transport bounds stalled bodies and makes outages terminal',async(context)=>{
 const {createConfirmationAuthTransport}=await import('../lib/auth/invitation-confirmation-auth.ts');
 const original=globalThis.fetch;context.mock.timers.enable({apis:['setTimeout']});let calls=0;
 try{
  globalThis.fetch=async(_input,init)=>{calls++;assert.equal(init?.cache,'no-store');assert.equal(init?.redirect,'error');return new Response(new ReadableStream({start(controller){init?.signal?.addEventListener('abort',()=>controller.error(new Error('provider_secret_canary')),{once:true});}}));};
  const transport=createConfirmationAuthTransport(),pending=transport.fetch('https://example.supabase.co/auth/v1/verify',{});await Promise.resolve();context.mock.timers.tick(5001);
  const response=await pending;assert.equal(response.status,400);assert.equal(transport.isUnavailable(),true);assert.ok(!(await response.text()).includes('canary'));
  await transport.fetch('https://example.supabase.co/auth/v1/verify',{});assert.equal(calls,1,'no outbound retry after timeout');transport.close();
  globalThis.fetch=async()=>{calls++;return Response.json({message:'provider_secret_canary'},{status:503});};
  const outage=createConfirmationAuthTransport(),failed=await outage.fetch('https://example.supabase.co/auth/v1/verify',{});assert.equal(outage.isUnavailable(),true);assert.ok(!(await failed.text()).includes('canary'));await outage.fetch('https://example.supabase.co/auth/v1/verify',{});assert.equal(calls,2);outage.close();
 }finally{globalThis.fetch=original;context.mock.timers.reset();}
});
