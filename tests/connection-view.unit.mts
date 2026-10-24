import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getConnectionView,type ConnectionViewPorts} from '../lib/flights/connection-view-query.ts';
import type {FlightConnection} from '../lib/flights/connection-query.ts';
import type {DetailFlight} from '../lib/flights/detail-query.ts';
import type {DirectoryProfile} from '../lib/profiles/directory-query.ts';
const request='20200000-0000-4000-8000-000000000001',flightId='20200000-0000-4000-8000-000000000002',owner='20200000-0000-4000-8000-000000000003',pilotId='20200000-0000-4000-8000-000000000004';
const connection:FlightConnection={requestId:request,flightId,ownerId:owner,requesterId:pilotId,counterpartId:pilotId,isOwner:true};
const flight={id:flightId,owner_id:owner,isOwn:true,status:'open',isPast:false,notes:'Allowed flight note'} as DetailFlight;
const pilot={user_id:pilotId,display_name:'Connected pilot',home_airport:'KPAO',pilot_designation:'licensed',photoAvailable:false,certificates:[],ratings:[],aircraft_access:null,flying_interests:null,bio:null} as DirectoryProfile;
const ports=():ConnectionViewPorts=>({connection:async()=>({status:'authorized',connection}),flight:async id=>{assert.equal(id,flightId);return {status:'authorized',flight,pilot:null};},pilot:async id=>{assert.equal(id,pilotId);return {status:'authorized',profile:pilot};}});
test('connection view composes only bound flight and permitted counterpart details',async()=>{
 assert.deepEqual(await getConnectionView(request,ports()),{status:'authorized',connection,flight,pilot});
 assert.deepEqual(await getConnectionView(request,{...ports(),pilot:async()=>({status:'missing'})}),{status:'authorized',connection,flight,pilot:null});
 assert.equal((await getConnectionView(request,{...ports(),pilot:async()=>{throw Error('private-canary');}})).status,'authorized');
});
test('connection view denies before loading details and discards mid-read revoked or changed grants',async()=>{
 for(const status of ['missing','forbidden','unauthenticated','unavailable'] as const){assert.deepEqual(await getConnectionView(request,{...ports(),connection:async()=>({status}),flight:async()=>assert.fail('No denied flight read'),pilot:async()=>assert.fail('No denied pilot read')}),{status});let n=0;assert.deepEqual(await getConnectionView(request,{...ports(),connection:async()=>++n===1?{status:'authorized',connection}:{status}}),{status});}
 let n=0;assert.deepEqual(await getConnectionView(request,{...ports(),connection:async()=>({status:'authorized',connection:++n===1?connection:{...connection,isOwner:false,counterpartId:owner}})}),{status:'forbidden'});
});
test('connection view rejects mismatched or closed flight and foreign pilot data',async()=>{
 for(const value of [{...flight,id:owner},{...flight,owner_id:pilotId},{...flight,isOwn:false},{...flight,status:'cancelled' as const}])assert.deepEqual(await getConnectionView(request,{...ports(),flight:async()=>({status:'authorized',flight:value,pilot:null})}),{status:'missing'});
 assert.deepEqual(await getConnectionView(request,{...ports(),pilot:async()=>({status:'authorized',profile:{...pilot,user_id:owner}})}),{status:'unavailable'});
});
