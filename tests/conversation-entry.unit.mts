import assert from 'node:assert/strict';
import {test} from 'node:test';
import {conversationOpenPolicy,type OpenPorts} from '../lib/messages/open-mutation.ts';
import {getConnectionConversation,type ConnectionConversationPorts} from '../lib/messages/connection-query.ts';
const id=(n:number)=>`21100000-0000-4000-8000-${n.toString().padStart(12,'0')}`;
const viewer=id(1),other=id(2),request=id(3),thread=id(4),member={userId:viewer,role:'member' as const};
const connection={requestId:request,flightId:id(5),ownerId:viewer,requesterId:other,counterpartId:other,isOwner:true};
const row={id:thread,flight_request_id:request,owner_id:viewer,requester_id:other,created_at:'2026-10-25T12:00:00Z',closed_at:null};
const ports=():OpenPorts=>({connection:async target=>{assert.equal(target,request);return {status:'authorized',connection};},open:async target=>{assert.equal(target,request);return {data:thread,error:null};},thread:async target=>{assert.equal(target,thread);return row;}});
const retained=():ConnectionConversationPorts=>({access:async()=>({status:'authorized',member}),read:async target=>{assert.equal(target,request);return row;}});
test('opening accepts only the request UUID and derives the confirmed conversation from its approved pair',async()=>{
 const policy=conversationOpenPolicy(ports());assert.deepEqual(policy.parse({request_id:request.toUpperCase()}),{ok:true,value:{requestId:request}});
 for(const raw of [null,[],{}, {request_id:'bad'},{request_id:request,conversation_id:thread},{request_id:request,owner_id:viewer},{request_id:request,requester_id:other}])assert.deepEqual(policy.parse(raw),{ok:false});
 assert.notEqual(policy.requireCompleteProfile,true);assert.deepEqual(await policy.effect(member,{requestId:request}),{code:'opened',conversationId:thread});
});
test('pending, foreign or revoked connections never produce a destination',async()=>{
 for(const status of ['missing','forbidden','unavailable','unauthenticated'] as const){const p=ports();p.connection=async()=>({status});p.open=async()=>assert.fail('No RPC without accepted connection');assert.notEqual((await conversationOpenPolicy(p).effect(member,{requestId:request})).code,'opened');}
 let reads=0;const p=ports();p.connection=async()=>++reads===1?{status:'authorized',connection}:{status:'missing'};assert.deepEqual(await conversationOpenPolicy(p).effect(member,{requestId:request}),{code:'conversation_unavailable'});
 const foreign={...connection,ownerId:id(9),requesterId:id(10)};assert.deepEqual(await conversationOpenPolicy({...ports(),connection:async()=>({status:'authorized',connection:foreign}),open:async()=>assert.fail('No foreign RPC')}).effect(member,{requestId:request}),{code:'conversation_unavailable'});
});
test('opening rejects mismatched or closed persisted identities and malformed provider replies',async()=>{
 for(const data of [null,{},'https://foreign.test',id(9).toUpperCase()])assert.deepEqual(await conversationOpenPolicy({...ports(),open:async()=>({data,error:null})}).effect(member,{requestId:request}),{code:'unavailable'});
 for(const value of [null,{...row,id:id(9)},{...row,flight_request_id:id(9)},{...row,owner_id:other,requester_id:viewer},{...row,closed_at:'2026-10-25T12:00:01Z'}])assert.notEqual((await conversationOpenPolicy({...ports(),thread:async()=>value}).effect(member,{requestId:request})).code,'opened');
});
test('opening handles ambiguous failures without leaking provider fields or automatically retrying',async()=>{
 for(const failure of ['throw','42501','XX000']){let calls=0;const value=await conversationOpenPolicy({...ports(),open:async()=>{calls++;if(failure==='throw')throw Error('private-provider-canary');return {data:null,error:{code:failure}};}}).effect(member,{requestId:request});assert.deepEqual(value,{code:failure==='42501'?'conversation_unavailable':'unavailable'});assert.equal(calls,1);}
});
test('retained lookup returns only the same-request participant conversation without creating or reopening it',async()=>{
 for(const closed_at of [null,'2026-10-25T12:00:01Z'])assert.deepEqual(await getConnectionConversation(request,{...retained(),read:async()=>({...row,closed_at})}),{status:'authorized',conversationId:thread});
 for(const value of [null,{...row,flight_request_id:id(9)},{...row,owner_id:id(9),requester_id:id(10)}])assert.notEqual((await getConnectionConversation(request,{...retained(),read:async()=>value})).status,'authorized');
});
test('retained lookup gates invalid IDs, unavailable reads and changing viewer authority',async()=>{
 assert.deepEqual(await getConnectionConversation('bad',{...retained(),read:async()=>assert.fail('No invalid query')}),{status:'missing'});
 assert.deepEqual(await getConnectionConversation(request,{...retained(),read:async()=>{throw Error('private-provider-canary');}}),{status:'unavailable'});
 for(const status of ['forbidden','unauthenticated','unavailable'] as const){assert.deepEqual(await getConnectionConversation(request,{...retained(),access:async()=>({status}),read:async()=>assert.fail('No denied query')}),{status});let reads=0;assert.deepEqual(await getConnectionConversation(request,{...retained(),access:async()=>++reads===1?{status:'authorized',member}:{status}}),{status});}
 let reads=0;assert.deepEqual(await getConnectionConversation(request,{...retained(),access:async()=>({status:'authorized',member:{...member,userId:++reads===1?viewer:other}})}),{status:'forbidden'});
});
