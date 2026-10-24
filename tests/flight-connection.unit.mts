import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getFlightConnection,type ConnectionPorts} from '../lib/flights/connection-query.ts';
import type {AccessResult} from '../lib/auth/access.ts';
const request='20100000-0000-4000-8000-000000000001',flight='20100000-0000-4000-8000-000000000002',owner='20100000-0000-4000-8000-000000000003',pilot='20100000-0000-4000-8000-000000000004',other='20100000-0000-4000-8000-000000000005';
const row={requestId:request,flightId:flight,ownerId:owner,requesterId:pilot};
const access=(id=owner):AccessResult=>({status:'authorized',member:{userId:id,role:'member'}});
const ports=(viewer=owner):ConnectionPorts=>({access:async()=>access(viewer),read:async id=>{assert.equal(id,request);return {...row,secret:'private-canary'};}});
test('connection derives only the approved pair and minimal counterpart for each participant',async()=>{
 for(const viewer of [owner,pilot])assert.deepEqual(await getFlightConnection(request.toUpperCase(),ports(viewer)),{status:'authorized',connection:{...row,counterpartId:viewer===owner?pilot:owner,isOwner:viewer===owner}});
});
test('connection rejects invalid, unrelated, malformed or unavailable rows without exposing provider fields',async()=>{
 assert.deepEqual(await getFlightConnection('invalid',{...ports(),read:async()=>assert.fail('No invalid read')}),{status:'missing'});
 assert.deepEqual(await getFlightConnection(request,ports(other)),{status:'missing'});
 assert.deepEqual(await getFlightConnection(request,{...ports(),read:async()=>null}),{status:'missing'});
 for(const data of [[],{}, {...row,requestId:other},{...row,flightId:'bad'},{...row,ownerId:pilot},{...row,requesterId:null}])assert.deepEqual(await getFlightConnection(request,{...ports(),read:async()=>data}),{status:'unavailable'});
 assert.deepEqual(await getFlightConnection(request,{...ports(),read:async()=>{throw Error('private-canary');}}),{status:'unavailable'});
});
test('connection rechecks access and derived state after reading, never retaining an earlier grant',async()=>{
 for(const status of ['unauthenticated','forbidden','unavailable'] as const)assert.deepEqual(await getFlightConnection(request,{...ports(),access:async()=>({status}),read:async()=>assert.fail('No denied read')}),{status});
 for(const after of [{status:'forbidden'},access(other)] as AccessResult[]){let n=0;assert.deepEqual(await getFlightConnection(request,{...ports(),access:async()=>++n===1?access():after}),{status:'forbidden'});}
 let n=0;assert.deepEqual(await getFlightConnection(request,{...ports(),read:async()=>++n===1?row:null}),{status:'missing'});
 n=0;assert.deepEqual(await getFlightConnection(request,{...ports(),read:async()=>++n===1?row:{...row,flightId:other}}),{status:'unavailable'});
});
