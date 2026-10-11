import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {cleanupProfilePhotos} from '../lib/profiles/photo-cleanup.ts';

const owner='44444444-4444-4444-8444-444444444444';
function claim(index:number){const id=`55555555-5555-4555-8555-${String(index).padStart(12,'0')}`;return {id,source_path:`${owner}/${id}/source`,final_path:`${owner}/${id}.webp`,claim_token:id,lease_until:new Date(Date.now()+60000).toISOString()};}
function setup(handler:(path:string,body:Record<string,unknown>,signal:AbortSignal|null|undefined)=>Promise<Response>){
 const previous={...process.env};
 process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='sb_publishable_cleanup_fixture';process.env.SUPABASE_SECRET_KEY='sb_secret_cleanup_fixture';
 const fetchMock=mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  assert.equal(url.origin,'http://127.0.0.1:54321');return handler(url.pathname,JSON.parse(String(init?.body??'{}')),init?.signal);
 });
 return ()=>{fetchMock.mock.restore();for(const key of ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY']){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}};
}
test('pending includes the owner work held by another claim or beyond a global batch',async()=>{
 let selectedOwner:unknown;
 const restore=setup(async(path,body)=>{
  if(path.endsWith('/claim_profile_photo_cleanup')){selectedOwner=body.cleanup_owner;return Response.json(body.cleanup_owner?[]:Array.from({length:20},(_,i)=>claim(i)));}
  if(path.endsWith('/count_profile_photo_cleanup')){assert.equal(body.cleanup_owner,owner);return Response.json(1);}
  if(path.endsWith('/ack_profile_photo_cleanup'))return Response.json({code:'acknowledged'});
  return Response.json([]);
 });
 try{const result=await cleanupProfilePhotos(20,{ownerId:owner,budgetMs:1000});assert.equal(result.pending,1);assert.equal(selectedOwner,owner);}
 finally{restore();}
});
test('total cleanup budget bounds slow batches and retains unprocessed work',async()=>{
 let acked=0,deletions=0;
 const restore=setup(async(path,_body,signal)=>{
  if(path.endsWith('/claim_profile_photo_cleanup'))return Response.json(Array.from({length:20},(_,i)=>claim(i)));
  if(path.endsWith('/count_profile_photo_cleanup'))return Response.json(20-acked);
  if(path.endsWith('/ack_profile_photo_cleanup')){acked++;return Response.json({code:'acknowledged'});}
  deletions++;await delay(20,undefined,{signal:signal??undefined});return Response.json([]);
 });
 try{const started=Date.now();const result=await cleanupProfilePhotos(20,{budgetMs:50});assert.ok(Date.now()-started<200,'Cleanup must stop at its total deadline');assert.ok(deletions<40);assert.ok(result.pending>0);assert.equal(result.pending,20-acked);}
 finally{restore();}
});
