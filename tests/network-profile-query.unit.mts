import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getNetworkProfile,type NetworkProfileQueryPorts} from '../lib/profiles/directory-query.ts';
import type {AccessResult} from '../lib/auth/access.ts';

const viewerId='61000000-0000-4000-8000-000000000001',targetId='6a000000-0000-4000-8000-000000000002';
const member:AccessResult={status:'authorized',member:{userId:viewerId,role:'member'}};
const row={user_id:targetId,display_name:'Other pilot',home_airport:'KPAO',pilot_designation:'licensed',certificates:[],ratings:[],aircraft_access:null,flying_interests:null,bio:null,photo_available:true};
const ports=(value:unknown=row):NetworkProfileQueryPorts=>({access:async()=>member,readRow:async()=>value});

test('profile reads require a current member and a single valid target',async()=>{
 for(const status of ['unauthenticated','forbidden','unavailable'] as const){
  let reads=0;
  assert.deepEqual(await getNetworkProfile(targetId,{access:async()=>({status}),readRow:async()=>{reads++;return row;}}),{status});
  assert.equal(reads,0);
 }
 for(const target of [null,undefined,[],{},'',targetId+',another','invalid','x'.repeat(5000)]){
  let reads=0;
  assert.deepEqual(await getNetworkProfile(target,{...ports(),readRow:async()=>{reads++;return row;}}),{status:'missing'});
  assert.equal(reads,0);
 }
 let requested:unknown;
 assert.equal((await getNetworkProfile(targetId.toUpperCase(),{...ports(),readRow:async id=>{requested=id;return row;}})).status,'authorized');
 assert.equal(requested,targetId);
});

test('profile DTO reuses the public projection and distinguishes absent from unavailable',async()=>{
 const result=await getNetworkProfile(targetId,ports({...row,email:'secret-canary',role:'admin',photo_storage_path:'secret-canary',created_at:'secret-canary'}));
 assert.deepEqual(result,{status:'authorized',profile:{user_id:targetId,display_name:'Other pilot',home_airport:'KPAO',pilot_designation:'licensed',certificates:[],ratings:[],aircraft_access:null,flying_interests:null,bio:null,photoAvailable:true}});
 assert.deepEqual(await getNetworkProfile(targetId,ports(null)),{status:'missing'});
 for(const value of [undefined,[],[row],{}, {...row,user_id:viewerId},{...row,pilot_designation:'student'},{...row,photo_available:'true'}])assert.deepEqual(await getNetworkProfile(targetId,{...ports(),readRow:async()=>value}),{status:'unavailable'});
 assert.deepEqual(await getNetworkProfile(targetId,{...ports(),readRow:async()=>{throw Error('secret-canary');}}),{status:'unavailable'});
});

test('profile reads discard results when access is revoked or identity changes',async()=>{
 for(const after of [{status:'forbidden'},{status:'unavailable'},{status:'unauthenticated'},{status:'authorized',member:{userId:targetId,role:'admin'}}] as AccessResult[]){
  let checks=0;
  const result=await getNetworkProfile(targetId,{...ports(),access:async()=>++checks===1?member:after});
  assert.notEqual(result.status,'authorized');assert.equal(checks,2);
 }
 for(const role of ['member','admin'] as const){
  const result=await getNetworkProfile(targetId,{...ports(),access:async()=>({status:'authorized',member:{userId:targetId,role}})});
  assert.equal(result.status,'authorized','Both members and admins may read their own public profile');
 }
});
