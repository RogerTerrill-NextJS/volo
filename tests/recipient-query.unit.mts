import assert from 'node:assert/strict';
import {test} from 'node:test';
import {listRecipientCandidates} from '../lib/flights/recipient-query.ts';
import type {DirectoryQueryPorts} from '../lib/profiles/directory-query.ts';
const id=(n:number)=>`17900000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const access={status:'authorized' as const,member:{userId:id(1),role:'member' as const}};
const row=(n:number)=>({user_id:id(n),display_name:'Pilot',home_airport:'KPAO',pilot_designation:'licensed',certificates:[],ratings:[],aircraft_access:null,flying_interests:null,bio:null,photo_available:false,email:'private-canary',disabled_reason:'private-canary'});
test('recipient candidates exclude verified viewer, preserve cursor and expose only picker fields',async()=>{
 const ports:DirectoryQueryPorts={access:async()=>access,readRows:async()=>[row(1),row(2)]};
 const first=await listRecipientCandidates({pageSize:1},ports);
 assert.deepEqual(first,{status:'authorized',rows:[],nextCursor:id(1)});
 const next=await listRecipientCandidates({after:id(1),pageSize:1},{...ports,readRows:async()=>[row(2)]});
 assert.deepEqual(next,{status:'authorized',rows:[{user_id:id(2),display_name:'Pilot',home_airport:'KPAO',photoAvailable:false}],nextCursor:null});
 assert.ok(!JSON.stringify(next).includes('private-canary'));
});
test('candidate reads fail closed on denied access and changed identity',async()=>{
 let reads=0;
 const denied=await listRecipientCandidates({}, {access:async()=>({status:'forbidden'}),readRows:async()=>{reads++;return [];}});
 assert.deepEqual(denied,{status:'forbidden'});assert.equal(reads,0);
 let checks=0;
 const switched=await listRecipientCandidates({}, {access:async()=>++checks<3?access:{status:'authorized',member:{userId:id(2),role:'member'}},readRows:async()=>[row(2)]});
 assert.notEqual(switched.status,'authorized');
});
