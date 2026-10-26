import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseFlightModeration,flightModerationPolicy} from '../lib/flights/moderation-mutation.ts';
import {listAdminFlights,type AdminFlightPorts} from '../lib/flights/moderation-query.ts';
const actor='21500000-0000-4000-8000-000000000001',target='21510000-0000-4000-8000-000000000001',at='2026-10-25T12:00:00.123456+00:00';
const member={userId:actor,role:'admin' as const},input={flightId:target,reason:'Safety review'};
const row={id:target,owner_id:actor,departure_airport:'KPAO',destination_airport:'KSQL',departure_at:at,departure_timezone:'UTC',departure_local_date:'2026-10-25',aircraft_description:'C172',pilot_places:2,visibility:'PRIVATE',status:'open',notes:'Post note',created_at:at,moderated_at:null,moderation_reason:null};
const ports=():AdminFlightPorts=>({access:async()=>({status:'authorized',member}),read:async()=>[row]});
test('moderation requires exact flight, bounded reason and explicit hide confirmation',()=>{
 assert.deepEqual(parseFlightModeration({flight_id:target.toUpperCase(),reason:' Safety review\r\n ',confirmation:'hide'}),input);
 for(const value of [null,{},[],{flight_id:target,reason:'Reason'},{flight_id:target,reason:' ',confirmation:'hide'},{flight_id:target,reason:'x'.repeat(501),confirmation:'hide'},{flight_id:target,reason:'Reason',confirmation:'hide',actor_id:actor},{flight_id:target,reason:'\u0000',confirmation:'hide'},{flight_id:target,reason:'\ud800',confirmation:'hide'}])assert.equal(parseFlightModeration(value),null);
 assert.equal(parseFlightModeration({flight_id:target,reason:'😀'.repeat(500),confirmation:'hide'})?.reason.length,1000);
});
test('moderation policy requires admin and confirms only exact target with timestamp and closed status',async()=>{
 const policy=flightModerationPolicy({hide:async value=>{assert.deepEqual(value,input);return {data:{code:'hidden',flightId:target,moderatedAt:at,status:'cancelled',privateData:'canary'},error:null};}});
 assert.deepEqual(policy.allowedRoles,['admin']);assert.equal(await policy.authorize({userId:actor,role:'member'},input),false);
 assert.deepEqual(await policy.effect(member,input),{code:'hidden',flightId:target,moderatedAt:at,status:'cancelled'});
 for(const data of [null,{}, {code:'hidden',flightId:actor,moderatedAt:at,status:'cancelled'},{code:'hidden',flightId:target,moderatedAt:'bad',status:'cancelled'},{code:'hidden',flightId:target,moderatedAt:at,status:'open'}])assert.deepEqual(await flightModerationPolicy({hide:async()=>({data,error:null})}).effect(member,input),{code:'moderation_unconfirmed'});
 assert.deepEqual(await policy.effect({userId:actor,role:'member'},input),{code:'forbidden'});
});
test('moderation failure is sanitized and ambiguous writes are never automatically repeated',async()=>{
 for(const [dbCode,code] of [['42501','forbidden'],['22023','invalid_input'],['XX000','moderation_unconfirmed']]){let calls=0;assert.deepEqual(await flightModerationPolicy({hide:async()=>{calls++;return {data:null,error:{code:dbCode}};}}).effect(member,input),{code});assert.equal(calls,1);}
 assert.deepEqual(await flightModerationPolicy({hide:async()=>{throw Error('private-canary');}}).effect(member,input),{code:'moderation_unconfirmed'});
 assert.deepEqual(await flightModerationPolicy({hide:async()=>({data:{code:'flight_unavailable',notes:'canary'},error:null})}).effect(member,input),{code:'flight_unavailable'});
});
test('admin overview bounds pagination and strips private conversation/provider data',async()=>{
 const result=await listAdminFlights(undefined,{...ports(),read:async()=>[{...row,email:'private-canary',messages:[{body:'private-canary'}]}]});assert.equal(result.status,'authorized');assert.ok(!JSON.stringify(result).includes('private-canary'));
 const rows=Array.from({length:51},(_,n)=>({...row,id:`21510000-0000-4000-8000-${String(n+1).padStart(12,'0')}`}));
 const page=await listAdminFlights(undefined,{...ports(),read:async()=>rows});assert.equal(page.status,'authorized');if(page.status==='authorized'){assert.equal(page.rows.length,50);assert.equal(page.nextCursor,rows[49].id);}
 assert.deepEqual(await listAdminFlights('bad',{...ports(),read:async()=>assert.fail('No invalid query')}),{status:'invalid'});
});
test('overview rejects non-admin, current role loss and malformed hidden state',async()=>{
 assert.deepEqual(await listAdminFlights(undefined,{...ports(),access:async()=>({status:'authorized',member:{...member,role:'member'}}),read:async()=>assert.fail('No member read')}),{status:'forbidden'});
 let reads=0;assert.deepEqual(await listAdminFlights(undefined,{...ports(),access:async()=>({status:'authorized',member:{...member,role:++reads===1?'admin':'member'}})}),{status:'forbidden'});
 for(const rows of [[row,row],[{...row,moderated_at:at}],[{...row,status:'cancelled',moderated_at:at,moderation_reason:null}],[{...row,moderation_reason:'unexpected'}],[{...row,created_at:'bad'}]])assert.deepEqual(await listAdminFlights(undefined,{...ports(),read:async()=>rows}),{status:'unavailable'});
 const hidden={...row,status:'completed',moderated_at:at,moderation_reason:'Safety review'};
 assert.equal((await listAdminFlights(undefined,{...ports(),read:async()=>[hidden]})).status,'authorized');
});
