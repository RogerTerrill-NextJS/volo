import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createConfirmationStore} from '../lib/auth/invitation-confirmation-store.ts';
test('redemption binds verified authority and exposes only recognized outcomes without transport retries',async()=>{
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='sb_publishable_fixture';process.env.SUPABASE_SECRET_KEY='sb_secret_fixture';
 const original=globalThis.fetch;let response:unknown={code:'redeemed'},calls=0,fail=false;
 const input={invitationId:'33000000-0000-4000-8000-000000000153',version:1,authorizationId:'44000000-0000-4000-8000-000000000153',setupDigest:'a'.repeat(64),identity:{subject:'22000000-0000-4000-8000-000000000153',email:'member@example.invalid',sessionId:'55000000-0000-4000-8000-000000000153'},origin:'https://preview.invalid'};
 globalThis.fetch=async(url,init)=>{
  calls++;assert.equal(new URL(String(url)).pathname,'/rest/v1/rpc/redeem_invitation');assert.equal(init?.cache,'no-store');assert.equal(init?.redirect,'error');
  assert.deepEqual(JSON.parse(String(init?.body)),{p_invitation_id:input.invitationId,p_expected_version:1,p_setup_authorization_id:input.authorizationId,p_setup_digest:'a'.repeat(64),p_subject:input.identity.subject,p_email:'member@example.invalid',p_session_id:input.identity.sessionId,p_origin:'https://preview.invalid'});
  if(fail)throw new Error('private_canary');return Response.json(response);
 };
 try{
  const store=createConfirmationStore();
  for(const code of ['redeemed','already_redeemed','conflict','denied'] as const){response={code,private:'private_canary'};assert.deepEqual(await store.redeem(input),{code});}
  for(const malformed of [{code:'unexpected'},null,[],{code:7}]){response=malformed;assert.deepEqual(await store.redeem(input),{code:'unavailable'});}
  fail=true;assert.deepEqual(await store.redeem(input),{code:'unavailable'});assert.equal(calls,9);
 }finally{globalThis.fetch=original;delete process.env.SUPABASE_SECRET_KEY;}
});
test('concrete confirmation RPC is private, bounded and refuses malformed success evidence',async()=>{
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='sb_publishable_fixture';process.env.SUPABASE_SECRET_KEY='sb_secret_fixture';
 const original=globalThis.fetch;let body:unknown,broken=false,calls=0;
 globalThis.fetch=async(input,init)=>{calls++;const url=new URL(String(input));assert.equal(url.pathname,'/rest/v1/rpc/claim_invitation_confirmation_transport');assert.equal(init?.cache,'no-store');assert.equal(init?.redirect,'error');body=JSON.parse(String(init?.body));return Response.json(broken?{code:'claimed',envelope:{token:'secret_canary'}}:{code:'denied'});};
 try{
  const store=createConfirmationStore();assert.deepEqual(await store.claim({lookupDigest:'a'.repeat(64),csrfDigest:'b'.repeat(64),origin:'https://preview.invalid'}),{code:'denied'});
  assert.deepEqual(body,{p_lookup_digest:'a'.repeat(64),p_csrf_digest:'b'.repeat(64),p_origin:'https://preview.invalid'});assert.equal(calls,1);
  broken=true;assert.deepEqual(await store.claim({lookupDigest:'a'.repeat(64),csrfDigest:'b'.repeat(64),origin:'https://preview.invalid'}),{code:'unavailable'});assert.equal(calls,2);
 }finally{globalThis.fetch=original;delete process.env.SUPABASE_SECRET_KEY;}
});

test('concrete store body deadline cancels the request without retry',async(context)=>{
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='sb_publishable_fixture';process.env.SUPABASE_SECRET_KEY='sb_secret_fixture';
 const original=globalThis.fetch;context.mock.timers.enable({apis:['setTimeout']});let calls=0;
 globalThis.fetch=async(_input,init)=>{calls++;return new Response(new ReadableStream({start(controller){init?.signal?.addEventListener('abort',()=>controller.error(new Error('store_secret_canary')),{once:true});}}));};
 try{
  const pending=createConfirmationStore().read({lookupDigest:'a'.repeat(64),origin:'https://preview.invalid'});await new Promise(resolve=>setImmediate(resolve));context.mock.timers.tick(5001);
  assert.deepEqual(await pending,{code:'unavailable'});assert.equal(calls,1);
 }finally{globalThis.fetch=original;context.mock.timers.reset();delete process.env.SUPABASE_SECRET_KEY;}
});
