import assert from 'node:assert/strict';
import {test} from 'node:test';
import {listIncomingRequests,type IncomingPorts} from '../lib/flights/incoming-query.ts';
import type {AccessResult} from '../lib/auth/access.ts';
const flight='19200000-0000-4000-8000-000000000001',viewer='19200000-0000-4000-8000-000000000002',requester='19200000-0000-4000-8000-000000000003';
const access:AccessResult={status:'authorized',member:{userId:viewer,role:'member'}};
const id=(n:number)=>`19200000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const row=(n=30)=>({id:id(n),flight_id:flight,requester_id:id(n+100),introductory_note:'Hello owner',status:'pending',created_at:'2026-10-22T12:00:00.123456+00:00',private_canary:'never expose'});
const ports=(rows:unknown=[row()]):IncomingPorts=>({access:async()=>access,readOwnedFlight:async(f,v)=>{assert.equal(f,flight);assert.equal(v,viewer);return {id:flight,owner_id:viewer};},readRows:async f=>{assert.equal(f,flight);return rows;},readPilot:async()=>({status:'missing'})});
test('owner list projects bounded notes and every legal state without extra columns',async()=>{
 for(const status of ['pending','accepted','declined','withdrawn','cancelled']){
  const data={...row(),requester_id:requester,status};
  const result=await listIncomingRequests(flight,null,ports([data]));
  assert.deepEqual(result,{status:'authorized',rows:[{id:data.id,requesterId:requester,note:'Hello owner',status,createdAt:'2026-10-22T12:00:00.123456Z',pilot:null}],nextCursor:null});
 }
});
test('unrelated owners and admins cannot query requests or profiles',async()=>{
 for(const role of ['member','admin'] as const)for(const owned of [null,{id:flight,owner_id:requester}]){
  assert.deepEqual(await listIncomingRequests(flight,null,{...ports(),access:async()=>({status:'authorized',member:{userId:viewer,role}}),readOwnedFlight:async()=>owned,readRows:async()=>assert.fail('Foreign list read'),readPilot:async()=>assert.fail('Foreign profile read')}),{status:'missing'});
 }
 for(const status of ['unauthenticated','forbidden','unavailable'] as const)assert.deepEqual(await listIncomingRequests(flight,null,{...ports(),access:async()=>({status}),readOwnedFlight:async()=>assert.fail('Denied flight read')}),{status});
});
test('newest-first pagination uses creation time and UUID tie breaker without a profile read for lookahead',async()=>{
 const data=Array.from({length:21},(_,n)=>row(50-n));let reads=0;
 const result=await listIncomingRequests(flight,null,{...ports(data),readPilot:async()=>{reads++;return {status:'missing'};}}) as {rows:unknown[];nextCursor:string};
 assert.equal(result.rows.length,20);assert.equal(reads,20);assert.equal(result.nextCursor,'2026-10-22T12:00:00.123456Z~'+id(31));
 assert.deepEqual(await listIncomingRequests(flight,result.nextCursor,{...ports([row(30)]),readRows:async(_,after)=>{assert.deepEqual(after,{createdAt:'2026-10-22T12:00:00.123456Z',id:id(31)});return [row(30)];}}),{status:'authorized',rows:[{id:id(30),requesterId:id(130),note:'Hello owner',status:'pending',createdAt:'2026-10-22T12:00:00.123456Z',pilot:null}],nextCursor:null});
 for(const after of ['bad', ['bad'], '2026-02-30T12:00:00.000000Z~'+id(1)])assert.deepEqual(await listIncomingRequests(flight,after,{...ports(),readRows:async()=>assert.fail('Invalid cursor read')}),{status:'invalid'});
});
test('revoked membership, changed identity or lost ownership discards the result',async()=>{
 for(const after of [{status:'forbidden'},{status:'authorized',member:{userId:requester,role:'admin'}}] as AccessResult[]){let calls=0;assert.deepEqual(await listIncomingRequests(flight,null,{...ports(),access:async()=>++calls===1?access:after}),{status:'forbidden'});}
 let reads=0;assert.deepEqual(await listIncomingRequests(flight,null,{...ports(),readOwnedFlight:async()=>++reads===1?{id:flight,owner_id:viewer}:null}),{status:'missing'});
});
test('malformed, foreign, unordered or oversized rows and provider failures fail closed',async()=>{
 for(const data of [[{...row(),flight_id:requester}],[{...row(),status:'draft'}],[{...row(),introductory_note:'n'.repeat(501)}],[{...row(),created_at:'2026-02-30T12:00:00Z'}],[row(),row()], [row(30),row(31)],Array.from({length:22},(_,n)=>row(50-n))])assert.deepEqual(await listIncomingRequests(flight,null,ports(data)),{status:'unavailable'});
 assert.deepEqual(await listIncomingRequests(flight,null,{...ports(),readRows:async()=>{throw Error('private-provider-canary');}}),{status:'unavailable'});
 assert.deepEqual(await listIncomingRequests('invalid',null,{...ports(),readRows:async()=>assert.fail('Invalid flight read')}),{status:'missing'});
 assert.deepEqual(await listIncomingRequests(flight,null,ports([])),{status:'authorized',rows:[],nextCursor:null});
});
test('requester profile uses only permitted presentation fields and denial discards the list',async()=>{
 const profile={user_id:row().requester_id,display_name:'Safe pilot',home_airport:'KPAO',pilot_designation:'licensed' as const,certificates:[],ratings:[],aircraft_access:null,flying_interests:null,bio:'Unneeded profile bio',photoAvailable:false};
 const result=await listIncomingRequests(flight,null,{...ports(),readPilot:async()=>({status:'authorized',profile})});
 assert.equal(result.status,'authorized');if(result.status!=='authorized')return;
 assert.deepEqual(result.rows[0].pilot,{userId:profile.user_id,displayName:'Safe pilot',homeAirport:'KPAO'});assert.ok(!JSON.stringify(result).includes('Unneeded profile bio'));
 for(const status of ['forbidden','unauthenticated'] as const)assert.deepEqual(await listIncomingRequests(flight,null,{...ports(),readPilot:async()=>({status})}),{status});
 const timedOut=await listIncomingRequests(flight,null,{...ports(),readPilot:async()=>{throw new DOMException('Timed out','TimeoutError');}});
 assert.equal(timedOut.status,'authorized');if(timedOut.status==='authorized')assert.equal(timedOut.rows[0].pilot,null);
 assert.deepEqual(await listIncomingRequests(flight,null,{...ports(),readPilot:async()=>({status:'authorized',profile:{...profile,user_id:requester}})}),{status:'unavailable'});
});
test('deleted requester label does not preserve an approval revoked during lookup',async()=>{
 let revoked=false;
 assert.deepEqual(await listIncomingRequests(flight,null,{...ports(),readDeleted:async()=>{revoked=true;return true;},access:async()=>revoked?{status:'forbidden'}:access}),{status:'forbidden'});
});
