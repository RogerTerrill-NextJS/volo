import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getClosedConnection,type ClosedConnectionPorts} from '../lib/flights/closed-connection-query.ts';
import type {DetailFlight} from '../lib/flights/detail-query.ts';
const request='20300000-0000-4000-8000-000000000001',flightId='20300000-0000-4000-8000-000000000002',owner='20300000-0000-4000-8000-000000000003',pilot='20300000-0000-4000-8000-000000000004';
const row={id:request,flight_id:flightId,requester_id:pilot,status:'cancelled',introductory_note:'Retained introduction',extra:'provider-canary'};
const flight={id:flightId,owner_id:owner,isOwn:false,status:'cancelled'} as DetailFlight;
const ports=(viewer=pilot):ClosedConnectionPorts=>({access:async()=>({status:'authorized',member:{userId:viewer,role:'member'}}),read:async id=>{assert.equal(id,request);return row;},flight:async()=>({status:'authorized',flight:{...flight,isOwn:viewer===owner},pilot:null})});
test('closed history preserves only participant request fields and permitted flight details for both pilots',async()=>{
 for(const viewer of [pilot,owner])for(const status of ['cancelled','withdrawn']){
  const result=await getClosedConnection(request,{...ports(viewer),read:async()=>({...row,status})});
  assert.equal(result.status,'closed');if(result.status!=='closed')continue;
  assert.equal(result.history.status,status);assert.equal(result.history.isOwner,viewer===owner);assert.equal(result.history.note,row.introductory_note);assert.ok(result.flight);assert.ok(!JSON.stringify(result).includes('provider-canary'));
 }
 const result=await getClosedConnection(request,{...ports(),flight:async()=>({status:'missing'})});
 assert.equal(result.status,'closed');if(result.status==='closed')assert.equal(result.flight,null);
 assert.deepEqual(await getClosedConnection(request,{...ports(owner),flight:async()=>({status:'missing'})}),{status:'missing'});
});
test('active, pending and declined records never become closed connections; invalid, foreign and denied reads fail closed',async()=>{
 for(const status of ['pending','accepted','declined'])assert.deepEqual(await getClosedConnection(request,{...ports(),read:async()=>({...row,status}),flight:async()=>assert.fail('No open request details')}),{status:'missing'});
 for(const status of ['unauthenticated','forbidden','unavailable'] as const)assert.deepEqual(await getClosedConnection(request,{...ports(),access:async()=>({status}),read:async()=>assert.fail('No denied history')}),{status});
 assert.deepEqual(await getClosedConnection('bad',{...ports(),read:async()=>assert.fail('No invalid read')}),{status:'missing'});
 assert.deepEqual(await getClosedConnection(request,{...ports(),read:async()=>null}),{status:'missing'});
 for(const bad of [{...row,id:owner},{...row,flight_id:'bad'},{...row,introductory_note:'x'.repeat(501)}])assert.deepEqual(await getClosedConnection(request,{...ports(),read:async()=>bad}),{status:'unavailable'});
 assert.deepEqual(await getClosedConnection(request,{...ports(owner),flight:async()=>({status:'authorized',flight:{...flight,isOwn:false},pilot:null})}),{status:'missing'});
});
test('rechecks reject resubmission, identity changes and revoked access, and discard newly hidden PRIVATE details',async()=>{
 let reads=0;assert.deepEqual(await getClosedConnection(request,{...ports(),read:async()=>++reads===1?row:{...row,status:'pending'}}),{status:'missing'});
 let access=0;assert.deepEqual(await getClosedConnection(request,{...ports(),access:async()=>({status:'authorized',member:{userId:++access===1?pilot:owner,role:'member'}})}),{status:'forbidden'});
 for(const status of ['forbidden','unauthenticated','unavailable'] as const){let checks=0;assert.deepEqual(await getClosedConnection(request,{...ports(),access:async()=>++checks===1?{status:'authorized',member:{userId:pilot,role:'member'}}:{status}}),{status});}
 let flightReads=0,resubmitted=false;assert.deepEqual(await getClosedConnection(request,{...ports(),read:async()=>resubmitted?{...row,status:'pending'}:row,flight:async()=>{if(++flightReads===2)resubmitted=true;return {status:'authorized',flight,pilot:null};}}),{status:'missing'});
 let details=0;const result=await getClosedConnection(request,{...ports(),flight:async()=>++details===1?{status:'authorized',flight,pilot:null}:{status:'missing'}});assert.equal(result.status,'closed');if(result.status==='closed')assert.equal(result.flight,null);
 assert.deepEqual(await getClosedConnection(request,{...ports(),read:async()=>{throw Error('provider-canary');}}),{status:'unavailable'});
});
