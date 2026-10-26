import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getNotificationDestination,type DestinationPorts} from '../lib/notifications/destination.ts';
const id=(n:number)=>`22200000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const viewer=id(1),notice=id(50),request=id(60),message=id(70),flight=id(80),thread=id(90),member={userId:viewer,role:'member' as const};
const ports=(event='request_received'):DestinationPorts=>({access:async()=>({status:'authorized',member}),notification:async()=>({id:notice,recipient_id:viewer,event_type:event,request_id:event==='message_received'?null:request,message_id:event==='message_received'?message:null}),request:async()=>({id:request,flight_id:flight}),message:async()=>({id:message,conversation_id:thread})});
test('each event maps only its validated source reference to a fixed existing destination',async()=>{
 for(const [event,href] of [['request_received',`/dashboard/flights/${flight}#incoming-heading`],['request_accepted',`/dashboard/connections/${request}`],['message_received',`/messages/${thread}`]]){
  const r=await getNotificationDestination(notice,ports(event));assert.deepEqual(r,{status:'authorized',href});
 }
});
test('foreign/missing notification and source references fail closed without a target lookup',async()=>{
 for(const bad of [null,{id:notice,recipient_id:id(2),event_type:'request_received',request_id:request,message_id:null}]){
  assert.deepEqual(await getNotificationDestination(notice,{...ports(),notification:async()=>bad,request:async()=>assert.fail('No unauthorized source read')}),{status:'missing'});
 }
 for(const field of ['request','message'] as const)assert.deepEqual(await getNotificationDestination(notice,{...ports(field==='message'?'message_received':'request_received'),[field]:async()=>null}),{status:'missing'});
});
test('malformed source type, identity and UUIDs never become redirect input',async()=>{
 for(const bad of [{id:notice,recipient_id:viewer,event_type:'email',request_id:request,message_id:null}, {id:notice,recipient_id:viewer,event_type:'message_received',request_id:request,message_id:message},{id:id(99),recipient_id:viewer,event_type:'request_received',request_id:request,message_id:null}]){
  assert.deepEqual(await getNotificationDestination(notice,{...ports(),notification:async()=>bad}),{status:'unavailable'});
 }
 for(const value of ['https://evil.invalid','//evil.invalid',flight+',or.evil',null])assert.deepEqual(await getNotificationDestination(notice,{...ports(),request:async()=>({id:request,flight_id:value})}),{status:'unavailable'});
 assert.deepEqual(await getNotificationDestination(notice,{...ports(),request:async()=>({id:id(2),flight_id:flight})}),{status:'unavailable'});
 assert.deepEqual(await getNotificationDestination(notice,{...ports('message_received'),message:async()=>({id:message,conversation_id:'//evil.invalid'})}),{status:'unavailable'});
 for(const target of ['bad','//evil.invalid',[],null])assert.deepEqual(await getNotificationDestination(target,{...ports(),notification:async()=>assert.fail('Invalid target read')}),{status:'missing'});
});
test('ordinary access gates and final rechecks discard targets after revocation or account switching',async()=>{
 for(const status of ['unauthenticated','forbidden','unavailable'] as const){
  assert.deepEqual(await getNotificationDestination(notice,{...ports(),access:async()=>({status}),notification:async()=>assert.fail('Denied read')}),{status});
  let n=0;assert.deepEqual(await getNotificationDestination(notice,{...ports(),access:async()=>++n===1?{status:'authorized',member}:{status}}),{status});
 }
 let n=0;assert.deepEqual(await getNotificationDestination(notice,{...ports(),access:async()=>({status:'authorized',member:{...member,userId:++n===1?viewer:id(2)}})}),{status:'forbidden'});
});
test('provider errors return only safe unavailable states',async()=>{
 for(const method of ['notification','request','message'] as const)assert.deepEqual(await getNotificationDestination(notice,{...ports(method==='message'?'message_received':'request_received'),[method]:async()=>{throw Error('provider-secret');}}),{status:'unavailable'});
});
