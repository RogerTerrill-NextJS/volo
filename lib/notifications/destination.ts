import 'server-only';
import type {AccessResult} from '../auth/access.ts';
import {messageUuid as uuid} from '../messages/validation.ts';
export type DestinationPorts={
 access:()=>Promise<AccessResult>;
 notification:(id:string)=>Promise<unknown>;
 request:(id:string)=>Promise<unknown>;
 message:(id:string)=>Promise<unknown>;
};
export type DestinationResult={status:'authorized';href:string}|{[S in 'missing'|'unavailable'|'forbidden'|'unauthenticated']:{status:S}}['missing'|'unavailable'|'forbidden'|'unauthenticated'];
const fail=():never=>{throw Error('Notification target unavailable');};
function createPorts():DestinationPorts{
 const session=()=>import('../flights/client.ts').then(m=>m.flightMutationClient());
 return {
  access:async()=>(await import('../auth/access.ts')).getAccess(),
  async notification(id){const r=await(await session()).from('notifications').select('id,recipient_id,event_type,request_id,message_id').eq('id',id).retry(false).maybeSingle();if(r.error)return fail();return r.data;},
  async request(id){const r=await(await session()).from('flight_requests').select('id,flight_id').eq('id',id).retry(false).maybeSingle();if(r.error)return fail();return r.data;},
  async message(id){const r=await(await session()).from('messages').select('id,conversation_id').eq('id',id).retry(false).maybeSingle();if(r.error)return fail();return r.data;},
 };
}
function record(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))return fail();return value as Record<string,unknown>;
}
/** Read-only recipient lookup. A reference is never a grant: each destination reauthorizes. */
export async function getNotificationDestination(id:unknown,ports:DestinationPorts=createPorts()):Promise<DestinationResult>{try{
 const before=await ports.access();if(before.status!=='authorized')return {status:before.status};
 if(typeof id!=='string'||!uuid.test(id.toLowerCase()))return {status:'missing'};
 const target=id.toLowerCase(),viewer=before.member.userId,raw=await ports.notification(target);
 if(raw===null)return {status:'missing'};
 const notice=record(raw);if(notice.recipient_id!==viewer)return {status:'missing'};
 if(notice.id!==target)return fail();
 let href:string;
 if(notice.event_type==='request_received'||notice.event_type==='request_accepted'){
  if(typeof notice.request_id!=='string'||!uuid.test(notice.request_id)||notice.message_id!==null)return fail();
  const source=await ports.request(notice.request_id);if(source===null)return {status:'missing'};
  const request=record(source);if(request.id!==notice.request_id||typeof request.flight_id!=='string'||!uuid.test(request.flight_id))return fail();
  href=notice.event_type==='request_received'?`/dashboard/flights/${request.flight_id}#incoming-heading`:`/dashboard/connections/${notice.request_id}`;
 }else if(notice.event_type==='message_received'){
  if(typeof notice.message_id!=='string'||!uuid.test(notice.message_id)||notice.request_id!==null)return fail();
  const source=await ports.message(notice.message_id);if(source===null)return {status:'missing'};
  const message=record(source);if(message.id!==notice.message_id||typeof message.conversation_id!=='string'||!uuid.test(message.conversation_id))return fail();
  href=`/messages/${message.conversation_id}`;
 }else return fail();
 const after=await ports.access();if(after.status!=='authorized')return {status:after.status};if(after.member.userId!==viewer)return {status:'forbidden'};
 return {status:'authorized',href};
}catch{return {status:'unavailable'};}}
