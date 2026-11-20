import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerNextFrameworkImports} from './helpers/next-framework-imports.mjs';
import {NextRequest} from 'next/server.js';
import {previewAliasResponse} from '../lib/http/preview-alias.ts';

const canonical='https://volo-a1b2c3-volo7.vercel.app',alias='https://volo-git-feature-volo7.vercel.app';

test('preview alias navigation uses the canonical deployment and drops query values before auth',()=>{
 for(const method of ['GET','HEAD']){
  const reply=previewAliasResponse(new NextRequest(alias+'/dashboard/flights?token_hash=query-canary&after=page',{method}),canonical,alias);
  assert.equal(reply?.status,303);
  assert.equal(reply?.headers.get('location'),canonical+'/dashboard/flights');
  assert.equal(reply?.headers.get('referrer-policy'),'no-referrer');
  assert.match(reply?.headers.get('cache-control')??'',/private.*no-store/);
  assert.equal(reply?.headers.get('vercel-cdn-cache-control'),'no-store');
  assert.equal(reply?.headers.get('set-cookie'),null);
 }
 const doubled=previewAliasResponse(new NextRequest(alias+'//foreign.invalid/path'),canonical,alias);
 assert.equal(new URL(doubled!.headers.get('location')!).origin,canonical);
});

test('alias credentials and callbacks are rejected without redirecting their body or tokens',()=>{
 for(const request of [
  new NextRequest(alias+'/auth/login',{method:'POST',body:'password=credential-canary'}),
  new NextRequest(alias+'/auth/confirm?token_hash=token-canary'),
  new NextRequest(alias+'/auth/confirm/?resume=token-canary'),
 ]){
  const reply=previewAliasResponse(request,canonical,alias);
  assert.equal(reply?.status,403);
  assert.equal(reply?.headers.get('location'),null);
  assert.equal(reply?.headers.get('set-cookie'),null);
 }
});

test('canonical and unknown hosts cannot enable alias routing using forwarded headers',()=>{
 for(const url of [canonical+'/login','https://foreign.invalid/login'])assert.equal(previewAliasResponse(new NextRequest(url,{headers:{'x-forwarded-host':new URL(alias).host}}),canonical,alias),null);
 assert.equal(previewAliasResponse(new NextRequest(alias+'/login'),canonical,''),null);
 assert.equal(previewAliasResponse(new NextRequest(canonical+'/login'),canonical,canonical),null);
});

test('Next internal request URLs still canonicalize the exact public branch host without authorizing writes',()=>{
 const headers={host:new URL(alias).host};
 const reply=previewAliasResponse(new NextRequest('http://127.0.0.1:3000/login?token_hash=canary',{headers}),canonical,alias);
 assert.equal(reply?.status,303);
 assert.equal(reply?.headers.get('location'),canonical+'/login');
 const denied=previewAliasResponse(new NextRequest('http://127.0.0.1:3000/auth/login',{headers,method:'POST',body:'password=canary'}),canonical,alias);
 assert.equal(denied?.status,403);
 assert.equal(denied?.headers.get('location'),null);
});

test('actual confirmation handlers reject branch alias callbacks outside the Proxy matcher',async()=>{
 const previous=[process.env.VOLO_MUTATION_ORIGIN,process.env.VOLO_PREVIEW_ALIAS_ORIGIN];
 process.env.VOLO_MUTATION_ORIGIN=canonical;process.env.VOLO_PREVIEW_ALIAS_ORIGIN=alias;
 // Match Next's extensionless framework imports when executing a route in Node.
 const imports=registerNextFrameworkImports();
 try{
  const {GET,HEAD,POST}=await import('../app/auth/confirm/route.ts');
  for(const [method,handler] of [['GET',GET],['HEAD',HEAD],['POST',POST]] as const){
   const request=new NextRequest(alias+'/auth/confirm?token_hash=invalid-canary',{method,headers:{Origin:canonical},...(method==='POST'?{body:'csrf=invalid-canary'}:{})});
   const reply=await Reflect.apply(handler,undefined,[request]);
   assert.equal(reply.status,403,method);
   assert.equal(reply.headers.get('location'),null);
   assert.equal(reply.headers.get('set-cookie'),null);
   assert.equal(await reply.text(),'');
  }
 }finally{
  imports.deregister();
  for(const [index,key] of ['VOLO_MUTATION_ORIGIN','VOLO_PREVIEW_ALIAS_ORIGIN'].entries())if(previous[index]===undefined)delete process.env[key];else process.env[key]=previous[index];
 }
});
