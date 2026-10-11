import assert from 'node:assert/strict';
import {test} from 'node:test';
import {uploadProfilePhoto} from '../lib/profiles/photo-client.ts';

const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',reservation='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const file=new File(['image fixture'],'pilot.png',{type:'image/png'});
const reserved=()=>Response.json({ok:true,data:{code:'reserved',reservationId:reservation,sourcePath:`${owner}/${reservation}/source`}});
test('upload finalizes only the owner reservation after a successful direct upload',async()=>{
 const calls:unknown[]=[];
 const request=(async(url,init)=>{calls.push([url,init?.body]);return calls.length===1?reserved():Response.json({ok:true,data:{code:'saved',cleanupPending:true}});}) as typeof fetch;
 const result=await uploadProfilePhoto(owner,file,async(path,bytes)=>{calls.push([path,bytes]);return {error:null};},request);
 assert.deepEqual(result,{cleanupPending:true});
 assert.equal(calls.length,3);assert.deepEqual(calls[1],[`${owner}/${reservation}/source`,file]);
 assert.deepEqual(calls[2],['/api/profile/photo',JSON.stringify({reservation_id:reservation})]);
});
test('invalid files are rejected before creating an upload reservation',async()=>{
 for(const file of [new File([],'empty.png',{type:'image/png'}),new File(['svg'],'photo.svg',{type:'image/svg+xml'}),new File([new Uint8Array(5_000_001)],'large.png',{type:'image/png'})]){
  let calls=0;
  await assert.rejects(uploadProfilePhoto(owner,file,async()=>{calls++;return {error:null};},(async()=>{calls++;return reserved();}) as typeof fetch));
  assert.equal(calls,0);
 }
});
test('failed direct uploads never finalize or expose provider errors',async()=>{
 let requests=0;
 await assert.rejects(uploadProfilePhoto(owner,file,async()=>({error:new Error('private-provider-canary')}),(async()=>{requests++;return reserved();}) as typeof fetch),error=>error instanceof Error&&!error.message.includes('private-provider-canary'));
 assert.equal(requests,1);
});
test('foreign reservations and rejected finalizations never report a saved photo',async()=>{
 let uploads=0;
 await assert.rejects(uploadProfilePhoto(owner,file,async()=>{uploads++;return {error:null};},(async()=>Response.json({ok:true,data:{code:'reserved',reservationId:reservation,sourcePath:`different-owner/${reservation}/source`}})) as typeof fetch));
 assert.equal(uploads,0);
 let requests=0;
 await assert.rejects(uploadProfilePhoto(owner,file,async()=>({error:null}),(async()=>++requests===1?reserved():Response.json({ok:false,code:'invalid_image'},{status:422})) as typeof fetch),/valid|supported|image/i);
 assert.equal(requests,2);
});
