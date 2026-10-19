import assert from 'node:assert/strict';
import {test} from 'node:test';
import {listDirectoryProfiles,type DirectoryQueryPorts} from '../lib/profiles/directory-query.ts';
import type {AccessResult} from '../lib/auth/access.ts';

const id=(n:number)=>`61000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const member:AccessResult={status:'authorized',member:{userId:id(1),role:'member'}};
const row=(n=1)=>({user_id:id(n),display_name:'Pilot',home_airport:'KPAO',pilot_designation:'licensed',certificates:[],ratings:[],aircraft_access:null,flying_interests:null,bio:null,photo_available:false});
const ports=(rows:unknown=[]):DirectoryQueryPorts=>({access:async()=>member,readRows:async()=>rows});

test('directory refuses unauthorized viewers before reading any profiles',async()=>{
 for(const status of ['unauthenticated','forbidden','unavailable'] as const){
  let reads=0;
  assert.deepEqual(await listDirectoryProfiles({}, {access:async()=>({status}),readRows:async()=>{reads++;return [row()];}}),{status});
  assert.equal(reads,0);
 }
});

test('directory validates and bounds pagination without querying invalid input',async()=>{
 for(const input of [null,[],{pageSize:0},{pageSize:51},{pageSize:1.5},{pageSize:'2'},{pageSize:NaN},{after:'invalid'},{after:'x'.repeat(5000)},{filter:'admin'}]){
  let reads=0;
  assert.deepEqual(await listDirectoryProfiles(input,{...ports(),readRows:async()=>{reads++;return [];}}),{status:'invalid'});
  assert.equal(reads,0);
 }
 let actual:unknown;
 const p={...ports(),readRows:async(input:unknown)=>{actual=input;return [];}};
 assert.deepEqual(await listDirectoryProfiles({},p),{status:'authorized',rows:[],nextCursor:null});
 assert.deepEqual(actual,{after:null,pageSize:20});
 await listDirectoryProfiles({after:id(1).toUpperCase(),pageSize:50},p);
 assert.deepEqual(actual,{after:id(1),pageSize:50});
});

test('directory returns minimal DTOs and derives next cursor from last returned row',async()=>{
 const result=await listDirectoryProfiles({pageSize:1},ports([{...row(1),email:'secret-canary',role:'admin',photo_storage_path:'secret-canary',created_at:'secret-canary'},row(2)]));
 assert.deepEqual(result,{status:'authorized',rows:[{user_id:id(1),display_name:'Pilot',home_airport:'KPAO',pilot_designation:'licensed',certificates:[],ratings:[],aircraft_access:null,flying_interests:null,bio:null,photoAvailable:false}],nextCursor:id(1)});
 assert.ok(!JSON.stringify(result).includes('secret-canary'));
 const last=await listDirectoryProfiles({after:id(1),pageSize:1},ports([row(2)]));
 assert.equal(last.status,'authorized');if(last.status==='authorized')assert.equal(last.nextCursor,null);
});

test('directory fails closed on malformed results and broken cursor ordering',async()=>{
 for(const rows of [null,{},[null],[{...row(),pilot_designation:'student'}],[{...row(),photo_available:'true'}],[{...row(),user_id:'invalid'}],[{...row(),display_name:''}],Array.from({length:22},(_,i)=>row(i+1)),[row(2),row(1)],[row(1),row(1)]]){
  assert.deepEqual(await listDirectoryProfiles({},ports(rows)),{status:'unavailable'});
 }
 assert.deepEqual(await listDirectoryProfiles({after:id(1)},ports([row(1)])),{status:'unavailable'});
 assert.deepEqual(await listDirectoryProfiles({}, {...ports(),readRows:async()=>{throw Error('secret-canary');}}),{status:'unavailable'});
});

test('directory discards results after membership revocation or session switch',async()=>{
 for(const after of [{status:'forbidden'},{status:'unavailable'},{status:'authorized',member:{userId:id(2),role:'member'}}] as AccessResult[]){
  let checks=0;
  const result=await listDirectoryProfiles({}, {...ports([row()]),access:async()=>++checks===1?member:after});
  assert.notEqual(result.status,'authorized');assert.equal(checks,2);
 }
 for(const role of ['member','admin'] as const){
  const result=await listDirectoryProfiles({}, {...ports([row()]),access:async()=>({status:'authorized',member:{userId:id(1),role}})});
  assert.equal(result.status,'authorized');
 }
});


test('directory normalizes bounded literal search and rejects malformed terms before reading',async()=>{
 let actual:unknown;
 const p={...ports(),readRows:async(input:unknown)=>{actual=input;return [];}};
 assert.equal((await listDirectoryProfiles({search:'  MiXeD\t  Name  ',after:id(1)},p)).status,'authorized');
 assert.deepEqual(actual,{after:id(1),pageSize:20,search:'MiXeD Name'});
 await listDirectoryProfiles({search:'\u00a0\u2003'},p);
 assert.deepEqual(actual,{after:null,pageSize:20});
 for(const search of ['%', '_', "O’Neil", 'KPAO', 'x'.repeat(80)]){
  assert.equal((await listDirectoryProfiles({search},p)).status,'authorized');
  assert.deepEqual(actual,{after:null,pageSize:20,search});
 }
 for(const search of [['a','b'],null,1,{},'x'.repeat(81),'bad\u0000name','\ud800']){
  let reads=0;
  assert.deepEqual(await listDirectoryProfiles({search},{...ports(),readRows:async()=>{reads++;return [];}}),{status:'invalid'});
  assert.equal(reads,0);
 }
});
