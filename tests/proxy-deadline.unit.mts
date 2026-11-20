import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setImmediate} from 'node:timers/promises';
import {createProxyAuthTransport} from '../lib/supabase/proxy-auth.ts';

for(const phase of ['fetch','body'] as const)test(`Auth deadline settles ${phase} even when abort does not settle the upstream promise`,async t=>{
 const original=globalThis.fetch;
 let release=()=>{};
 globalThis.fetch=(async()=>{
  if(phase==='fetch')return new Promise<Response>(resolve=>{release=()=>resolve(Response.json({id:'fictional'}));});
  return new Response(new ReadableStream({start(controller){
   controller.enqueue(new TextEncoder().encode('{"id":"fictional"}'));
   release=()=>controller.close();
  }}));
 }) as typeof globalThis.fetch;
 t.mock.timers.enable({apis:['setTimeout']});
 const transport=createProxyAuthTransport();
 let settled=false;
 const pending=transport.fetch('https://example.supabase.co/auth/v1/user').then(response=>{settled=true;return response;});
 try{
  await setImmediate();
  t.mock.timers.tick(5001);
  await setImmediate();
  assert.equal(settled,true,'deadline must settle independently of upstream abort handling');
  const response=await pending;
  assert.equal(response.status,400);
  assert.equal((await response.json()).error_code,'volo_auth_unavailable');
  assert.equal(transport.isUnavailable(),true);
 }finally{
  transport.close();release();await pending;
  globalThis.fetch=original;t.mock.timers.reset();
 }
});
