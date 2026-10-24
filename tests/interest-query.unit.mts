import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getOwnFlightInterest,type InterestQueryPorts} from '../lib/flights/interest-query.ts';
import type {AccessResult} from '../lib/auth/access.ts';
const flight='19000000-0000-4000-8000-000000000001',viewer='19000000-0000-4000-8000-000000000002',other='19000000-0000-4000-8000-000000000003';
const access:AccessResult={status:'authorized',member:{userId:viewer,role:'member'}};
const ports=(status='pending'):InterestQueryPorts=>({access:async()=>access,readRequest:async(f,v)=>{assert.equal(f,flight);assert.equal(v,viewer);return {id:other,flight_id:flight,requester_id:viewer,status};},readVisibleFlight:async id=>{assert.equal(id,flight);return {id:flight};},readProfile:async member=>{assert.equal(member.userId,viewer);return 'complete';}});
test('own interest reads only the verified requester and projects approved status',async()=>{
 for(const status of ['pending','accepted','withdrawn','declined','cancelled'])assert.deepEqual(await getOwnFlightInterest(flight.toUpperCase(),ports(status)),{status:'authorized',requestStatus:status,profileStatus:'complete',...(['accepted','withdrawn','cancelled'].includes(status)?{requestId:other}:{})});
 assert.deepEqual(await getOwnFlightInterest(flight,{...ports(),readRequest:async()=>null,readProfile:async()=> 'missing'}),{status:'authorized',requestStatus:'none',profileStatus:'missing'});
});
test('own interest denies invalid or revoked viewers and no longer visible private flights',async()=>{
 for(const status of ['unauthenticated','forbidden','unavailable'] as const)assert.deepEqual(await getOwnFlightInterest(flight,{...ports(),access:async()=>({status}),readRequest:async()=>assert.fail('Denied read')}),{status});
 assert.deepEqual(await getOwnFlightInterest('invalid',{...ports(),readRequest:async()=>assert.fail('Invalid read')}),{status:'missing'});
 for(const after of [{status:'forbidden'},{status:'authorized',member:{userId:other,role:'admin'}}] as AccessResult[]){let n=0;assert.equal((await getOwnFlightInterest(flight,{...ports(),access:async()=>++n===1?access:after})).status,'forbidden');}
 assert.deepEqual(await getOwnFlightInterest(flight,{...ports(),readVisibleFlight:async()=>null}),{status:'missing'});
});
test('own status failures cannot expose provider data or enable a new submission',async()=>{
 for(const data of [{id:'bad',flight_id:flight,requester_id:viewer,status:'accepted'},{flight_id:flight,requester_id:other,status:'pending'},{flight_id:other,requester_id:viewer,status:'pending'},{flight_id:flight,requester_id:viewer,status:'draft'},{flight_id:flight,requester_id:viewer,status:['pending']},[]]){
  assert.deepEqual(await getOwnFlightInterest(flight,{...ports(),readRequest:async()=>data}),{status:'authorized',requestStatus:'unavailable',profileStatus:'complete'});
 }
 assert.deepEqual(await getOwnFlightInterest(flight,{...ports(),readRequest:async()=>{throw Error('private-error-canary');}}),{status:'authorized',requestStatus:'unavailable',profileStatus:'complete'});
 assert.deepEqual(await getOwnFlightInterest(flight,{...ports(),readVisibleFlight:async()=>{throw Error('private-error-canary');}}),{status:'unavailable'});
});
