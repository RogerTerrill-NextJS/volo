import 'server-only';
import type {MutationPolicy} from '../auth/mutation.ts';
import {messageInstant as instant,messageUuid as uuid} from '../messages/validation.ts';
export type ReadResult={code:'read';id:string;readAt:string}|{code:'notification_unavailable'|'read_unconfirmed'|'forbidden'};
type Mark=(id:string)=>Promise<{data:unknown;error:{code?:string}|null}>;
async function mark(id:string){const client=await(await import('../flights/client.ts')).flightMutationClient();return client.rpc('mark_notification_read',{p_notification_id:id}).retry(false);}
/** Origin/session/input are independently checked by the shared action boundary. */
export function notificationReadPolicy(send:Mark=mark):MutationPolicy<{id:string},ReadResult>{return {
 allowedRoles:['member','admin'],
 parse(raw){if(!raw||typeof raw!=='object'||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))return {ok:false};const r=raw as Record<string,unknown>;if(Object.keys(r).length!==1||typeof r.notification_id!=='string'||!uuid.test(r.notification_id.toLowerCase()))return {ok:false};return {ok:true,value:{id:r.notification_id.toLowerCase()}};},
 authorize(){return true;},
 async effect(_member,input){try{
  const {data,error}=await send(input.id);if(error)return {code:error.code==='42501'?'forbidden':'read_unconfirmed'};
  if(!data||typeof data!=='object'||Array.isArray(data))return {code:'read_unconfirmed'};const r=data as Record<string,unknown>;
  if(r.code==='notification_unavailable')return {code:'notification_unavailable'};
  const readAt=instant(r.readAt);if(r.code!=='read'||r.id!==input.id||!readAt)return {code:'read_unconfirmed'};
  return {code:'read',id:input.id,readAt};
 }catch{return {code:'read_unconfirmed'};}},
};}
