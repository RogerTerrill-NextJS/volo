import 'server-only';
import type {AccessResult} from '../auth/access.ts';
import {messageUuid,projectMessageThread} from './validation.ts';
export type ConnectionConversationPorts={access:()=>Promise<AccessResult>;read:(requestId:string)=>Promise<unknown>};
type Result={status:'authorized';conversationId:string}|{status:'missing'|'unavailable'|'forbidden'|'unauthenticated'};
function createPorts():ConnectionConversationPorts{return {
 access:async()=>(await import('../auth/access.ts')).getAccess(),
 async read(id){const {flightMutationClient}=await import('../flights/client.ts');const result=await(await flightMutationClient()).from('conversations').select('id,flight_request_id,owner_id,requester_id,created_at,closed_at').eq('flight_request_id',id).retry(false).maybeSingle();if(result.error)throw Error('Conversation unavailable');return result.data;},
};}
/** Retained history is a read-only lookup, never a grant to reopen or send. */
export async function getConnectionConversation(id:unknown,ports:ConnectionConversationPorts=createPorts()):Promise<Result>{
 try{
  const before=await ports.access();if(before.status!=='authorized')return {status:before.status};
  if(typeof id!=='string'||!messageUuid.test(id.toLowerCase()))return {status:'missing'};
  const target=id.toLowerCase(),raw=await ports.read(target);
  const thread=raw&&typeof raw==='object'&&'id' in raw&&typeof raw.id==='string'?projectMessageThread(raw,raw.id,before.member.userId):null;
  const after=await ports.access();if(after.status!=='authorized')return {status:after.status};
  if(after.member.userId!==before.member.userId)return {status:'forbidden'};
  if(!thread||thread.requestId!==target)return {status:'missing'};
  return {status:'authorized',conversationId:thread.id};
 }catch{return {status:'unavailable'};}
}
