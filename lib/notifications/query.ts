import 'server-only';
import type {AccessResult} from '../auth/access.ts';
import {messageInstant as instant,messageUuid as uuid} from '../messages/validation.ts';
export type NotificationCursor={createdAt:string;id:string};
export type NotificationItem={id:string;eventType:'request_received'|'request_accepted'|'message_received';createdAt:string;readAt:string|null};
export type NotificationResult={status:'authorized';rows:NotificationItem[];nextCursor:string|null}|{[S in 'unauthenticated'|'forbidden'|'unavailable'|'invalid']:{status:S}}['unauthenticated'|'forbidden'|'unavailable'|'invalid'];
export type NotificationPorts={access:()=>Promise<AccessResult>;rows:(cursor:NotificationCursor|null)=>Promise<unknown>};
const fail=():never=>{throw Error('Notifications unavailable');};
function createPorts():NotificationPorts{return {
 access:async()=>(await import('../auth/access.ts')).getAccess(),
 async rows(after){
  const client=await(await import('../flights/client.ts')).flightMutationClient();
  let query=client.from('notifications').select('id,recipient_id,event_type,created_at,read_at').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(21);
  if(after)query=query.or(`created_at.lt.${after.createdAt},and(created_at.eq.${after.createdAt},id.lt.${after.id})`);
  const r=await query.retry(false);if(r.error)return fail();return r.data;
 },
};}
/** Session RLS plus defensive recipient projection; no source enrichment or read side effects. */
export async function listNotifications(after:unknown=null,ports:NotificationPorts=createPorts()):Promise<NotificationResult>{try{
 const access=await ports.access();if(access.status!=='authorized')return {status:access.status};const viewer=access.member.userId;
 let cursor:NotificationCursor|null=null;
 if(after!==null&&after!==undefined){if(typeof after!=='string')return {status:'invalid'};const [date,id,...rest]=after.split('~');if(rest.length||!date||instant(date)!==date||!id||!uuid.test(id))return {status:'invalid'};cursor={createdAt:date,id};}
 const data=await ports.rows(cursor);if(!Array.isArray(data)||data.length>21)return fail();
 const rows:NotificationItem[]=data.map(value=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return fail();const r=value as Record<string,unknown>,createdAt=instant(r.created_at),readAt=r.read_at===null?null:instant(r.read_at);
  if(typeof r.id!=='string'||!uuid.test(r.id)||r.recipient_id!==viewer||!createdAt||!['request_received','request_accepted','message_received'].includes(r.event_type as string)||(r.read_at!==null&&(!readAt||readAt<createdAt)))return fail();
  return {id:r.id,eventType:r.event_type as NotificationItem['eventType'],createdAt,readAt};
 });
 let previous=cursor;for(const row of rows){if(previous&&!(row.createdAt<previous.createdAt||(row.createdAt===previous.createdAt&&row.id<previous.id)))return fail();previous=row;}
 const fresh=await ports.access();if(fresh.status!=='authorized')return {status:fresh.status};if(fresh.member.userId!==viewer)return {status:'forbidden'};
 const visible=rows.slice(0,20),last=visible.at(-1);return {status:'authorized',rows:visible,nextCursor:rows.length>20&&last?`${last.createdAt}~${last.id}`:null};
}catch{return {status:'unavailable'};}}
