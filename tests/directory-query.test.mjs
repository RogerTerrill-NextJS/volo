import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startMutationFixture} from './helpers/mutation-fixture.mjs';

test('compiled directory helper uses the member session, bounded RPC and safe failure results',{timeout:120000},async()=>{
 const fixture=await startMutationFixture({directoryQuery:true});
 try{
  const viewer=await fixture.seed('directory-reader');
  const id='61000000-0000-4000-8000-000000000001';
  fixture.backend.directory.rows=[{user_id:id,display_name:'Pilot',home_airport:'KPAO',pilot_designation:'licensed',certificates:[],ratings:[],aircraft_access:null,flying_interests:null,bio:null,photo_available:true,email:'private-email-canary',photo_storage_path:'private-photo-canary'}];
  const route='/api/directory-fixture';
  const read=async(path=route,jar=viewer.jar)=>{
   const result=await fixture.request(path,jar);
   assert.equal(result.response.status,200);
   for(const name of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(result.response.headers.get(name),/no-store/);
   assert.doesNotMatch(result.body,/private-email-canary|private-photo-canary/);
   return JSON.parse(result.body);
  };
  let result=await read();
  assert.equal(result.status,'authorized');assert.equal(result.rows[0].photoAvailable,true);
  assert.deepEqual(fixture.backend.calls.filter(c=>c.service==='directory').at(-1),{service:'directory',subject:viewer.entry.id,method:'POST',payload:{p_page_size:20}});
  fixture.backend.directory.rows=[{...fixture.backend.directory.rows[0],user_id:'61000000-0000-4000-8000-000000000002'}];
  result=await read(`${route}?after=${id}&size=2`);
  assert.equal(result.status,'authorized');assert.equal(result.nextCursor,null);
  assert.deepEqual(fixture.backend.calls.filter(c=>c.service==='directory').at(-1).payload,{p_after:id,p_page_size:2});
  const reads=()=>fixture.backend.calls.filter(c=>c.service==='directory').length;
  const before=reads();
  assert.deepEqual(await read(`${route}?size=51`),{status:'invalid'});assert.equal(reads(),before);
  assert.deepEqual(await read(route,new Map()),{status:'unauthenticated'});assert.equal(reads(),before);
  viewer.entry.status='disabled';assert.deepEqual(await read(),{status:'forbidden'});assert.equal(reads(),before);
  viewer.entry.status='active';fixture.backend.directory.failure='down';
  assert.deepEqual(await read(),{status:'unavailable'});assert.equal(reads(),before+1,'Backend error is not retried');
  fixture.backend.directory.failure=null;fixture.backend.directory.rows=[];
  result=await read();assert.deepEqual(result,{status:'authorized',rows:[],nextCursor:null});
  assert.deepEqual(fixture.backend.unexpected,[]);
 }finally{await fixture.close();}
});
