import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getFlightDetail,type FlightDetailPorts} from '../lib/flights/detail-query.ts';
import type {AccessResult} from '../lib/auth/access.ts';
const id='71000000-0000-4000-8000-000000000001',owner='71000000-0000-4000-8000-000000000002';
const member:AccessResult={status:'authorized',member:{userId:id,role:'member'}};
const row={id,owner_id:owner,departure_airport:'KPAO',destination_airport:'KSQL',departure_at:'2028-06-02T00:30:00.000001+00:00',departure_timezone:'America/Los_Angeles',departure_local_date:'2028-06-01',aircraft_description:'C172',pilot_places:2,visibility:'PRIVATE',status:'open',notes:'First line\n<script>private text</script>'};
const ports=(data:unknown=row):FlightDetailPorts=>({access:async()=>member,now:()=>Date.parse('2027-01-01T00:00:00Z'),readRow:async requested=>{assert.equal(requested,id);return data;},readPilot:async requested=>{assert.equal(requested,owner);return {status:'missing'};}});

test('detail denies inactive viewers and invalid IDs before flight or pilot reads',async()=>{
 for(const status of ['unauthenticated','forbidden','unavailable'] as const){
  assert.deepEqual(await getFlightDetail(id,{...ports(),access:async()=>({status}),readRow:async()=>{assert.fail('Denied read');},readPilot:async()=>{assert.fail('Denied profile read');}}),{status});
 }
 for(const target of [null,undefined,[],{},'',id+',or(id.gt.0)','bad'])assert.deepEqual(await getFlightDetail(target,{...ports(),readRow:async()=>{assert.fail('Invalid ID read');}}),{status:'missing'});
});

test('detail whitelists permitted flight fields, preserves notes and does not require upcoming/open',async()=>{
 for(const status of ['open','cancelled','completed']){
  const result=await getFlightDetail(id.toUpperCase(),ports({...row,status,email:'account-canary',recipients:['private-canary'],created_at:'internal-canary'}));
  assert.deepEqual(result,{status:'authorized',flight:{...row,status,isOwn:false,isPast:false,departure_at:'2028-06-02T00:30:00.000001Z'},pilot:null});
 }
 assert.equal((await getFlightDetail(id,ports({...row,departure_at:'2000-01-01T00:00:00Z',departure_local_date:'1999-12-31'}))).status,'authorized');
});

test('missing/inaccessible flights never cause a posting-pilot lookup; errors are sanitized',async()=>{
 assert.deepEqual(await getFlightDetail(id,{...ports(null),readPilot:async()=>{assert.fail('No profile lookup for missing flight');}}),{status:'missing'});
 for(const data of [undefined,[],{}, {...row,id:owner},{...row,status:'draft'},{...row,notes:42},{...row,pilot_places:0},{...row,departure_local_date:'2028-06-02'},{...row,departure_timezone:'invalid'}])assert.deepEqual(await getFlightDetail(id,{...ports(),readRow:async()=>data}),{status:'unavailable'});
 assert.deepEqual(await getFlightDetail(id,{...ports(),readRow:async()=>{throw Error('provider-secret');}}),{status:'unavailable'});
});

test('optional pilot failures preserve flight while authorization failures discard it',async()=>{
 for(const status of ['missing','unavailable'] as const)assert.equal((await getFlightDetail(id,{...ports(),readPilot:async()=>({status})})).status,'authorized');
 for(const status of ['unauthenticated','forbidden'] as const)assert.deepEqual(await getFlightDetail(id,{...ports(),readPilot:async()=>({status})}),{status});
 const pilot={user_id:owner,display_name:'Posting pilot',home_airport:'KPAO',pilot_designation:'licensed' as const,certificates:[],ratings:[],aircraft_access:null,flying_interests:null,bio:null,photoAvailable:false};
 assert.deepEqual(await getFlightDetail(id,{...ports(),readPilot:async()=>({status:'authorized',profile:pilot})}),{status:'authorized',flight:{...row,isOwn:false,isPast:false,departure_at:'2028-06-02T00:30:00.000001Z'},pilot});
});

test('revocation or viewer identity change during flight/profile reads discards details',async()=>{
 for(const after of [{status:'forbidden'},{status:'unauthenticated'},{status:'unavailable'},{status:'authorized',member:{userId:owner,role:'admin'}}] as AccessResult[]){
  let checks=0;
  assert.notEqual((await getFlightDetail(id,{...ports(),access:async()=>++checks===1?member:after})).status,'authorized');
  assert.ok(checks>=2);
 }
 let revoked=false;
 assert.deepEqual(await getFlightDetail(id,{...ports(),access:async()=>revoked?{status:'forbidden'}:member,readPilot:async()=>{revoked=true;return {status:'missing'};}}),{status:'forbidden'});
});

test('detail ownership reflects the verified owner, including admins without an ownership bypass',async()=>{
 for(const role of ['member','admin'] as const)for(const own of [false,true]){
  const result=await getFlightDetail(id,{...ports({...row,isOwn:!own,user_metadata:{userId:owner},role:'admin'}),access:async()=>({status:'authorized',member:{userId:own?owner:id,role}})});
  assert.equal(result.status,'authorized');if(result.status!=='authorized')return;
  assert.equal(result.flight.isOwn,own);
 }
});

test('detail departure state uses the precise instant at or before the current server clock',async()=>{
 const now=Date.parse('2028-06-02T00:30:00.000Z');
 for(const [departure_at,isPast] of [['2028-06-02T00:29:59.999999Z',true],['2028-06-02T00:30:00.000000Z',true],['2028-06-02T00:30:00.000001Z',false]] as const){
  const result=await getFlightDetail(id,{...ports({...row,departure_at,isPast:!isPast}),now:()=>now});
  assert.equal(result.status,'authorized');if(result.status!=='authorized')return;
  assert.equal(result.flight.isPast,isPast,'Compare the instant, not its rounded milliseconds or departure-local date');
  assert.equal(result.flight.departure_at,departure_at,'Retain microsecond precision');
 }
 for(const status of ['cancelled','completed']){
  const result=await getFlightDetail(id,{...ports({...row,status}),now:()=>now+1000});
  assert.equal(result.status,'authorized');if(result.status==='authorized'){assert.equal(result.flight.status,status);assert.equal(result.flight.isPast,true);}
 }
});

test('detail departure state is evaluated fresh after reads and invalid clocks fail closed',async()=>{
 let now=Date.parse('2028-06-02T00:30:00.000Z');
 const p={...ports(),now:()=>now};
 let result=await getFlightDetail(id,p);assert.equal(result.status,'authorized');if(result.status==='authorized')assert.equal(result.flight.isPast,false);
 now+=1;result=await getFlightDetail(id,p);assert.equal(result.status,'authorized');if(result.status==='authorized')assert.equal(result.flight.isPast,true);
 now-=1;
 result=await getFlightDetail(id,{...p,readPilot:async()=>{now+=1;return {status:'missing'};}});assert.equal(result.status,'authorized');if(result.status==='authorized')assert.equal(result.flight.isPast,true);
 assert.deepEqual(await getFlightDetail(id,{...ports(),now:()=>NaN}),{status:'unavailable'});
});
