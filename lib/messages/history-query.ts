import 'server-only';
import type {AccessResult} from '../auth/access.ts';
import type {ConnectionResult} from '../flights/connection-query.ts';
import {messageUuid,messageInstant,validPersistedMessageBody,projectMessageThread} from './validation.ts';
export type HistoryCursor={createdAt:string;id:string};
export type HistoryMessage={id:string;senderId:string;body:string;createdAt:string};
export type HistoryPorts={deleted?:(id:string)=>Promise<boolean>;access:()=>Promise<AccessResult>;thread:(id:string)=>Promise<unknown>;messages:(id:string,before:HistoryCursor|null)=>Promise<unknown>;connection:(request:string)=>Promise<ConnectionResult>};
export type HistoryResult={status:'authorized';deletedPilot?:boolean;conversation:{id:string;requestId:string;counterpartId:string;closed:boolean};messages:HistoryMessage[];olderCursor:string|null;sendStatus:'available'|'closed'|'unavailable'}|{[S in 'missing'|'invalid'|'unauthenticated'|'forbidden'|'unavailable']:{status:S}}['missing'|'invalid'|'unauthenticated'|'forbidden'|'unavailable'];
const fail=()=>{throw Error('Message history unavailable');};
function createPorts():HistoryPorts{
 const client=()=>import('../flights/client.ts').then(m=>m.flightMutationClient());
 return {deleted:async id=>(await import('../deletion/labels.ts')).conversationHasDeletedPilot(id),access:async()=>(await import('../auth/access.ts')).getAccess(),connection:async request=>(await import('../flights/connection-query.ts')).getFlightConnection(request),
  async thread(id){const r=await(await client()).from('conversations').select('id,flight_request_id,owner_id,requester_id,created_at,closed_at').eq('id',id).retry(false).maybeSingle();if(r.error)return fail();return r.data;},
  async messages(id,before){let query=(await client()).from('messages').select('id,conversation_id,sender_id,body,created_at').eq('conversation_id',id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(31);if(before)query=query.or(`created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`);const r=await query.retry(false);if(r.error)return fail();return r.data;},
 };
}
/** Each page is chronological; its cursor fetches older persisted history. No flight DTOs or cached approval. */
export async function getConversationHistory(id:unknown,before:unknown=null,ports:HistoryPorts=createPorts()):Promise<HistoryResult>{
 try{
  const access=await ports.access();if(access.status!=='authorized')return {status:access.status};const viewer=access.member.userId;
  if(typeof id!=='string'||!messageUuid.test(id.toLowerCase()))return {status:'missing'};const target=id.toLowerCase();
  let cursor:HistoryCursor|null=null;
  if(before!==null&&before!==undefined){if(typeof before!=='string')return {status:'invalid'};const [createdAt,messageId,...rest]=before.split('~');if(rest.length||!createdAt||messageInstant(createdAt)!==createdAt||!messageId||!messageUuid.test(messageId))return {status:'invalid'};cursor={createdAt,id:messageId};}
  const raw=await ports.thread(target);if(raw===null)return {status:'missing'};const thread=projectMessageThread(raw,target,viewer);if(!thread)return fail();
  const data=await ports.messages(target,cursor);if(!Array.isArray(data)||data.length>31)return fail();let previous=cursor;
  const rows:HistoryMessage[]=data.map(value=>{
   if(!value||typeof value!=='object'||Array.isArray(value))return fail();const r=value as Record<string,unknown>,createdAt=messageInstant(r.created_at);
   if(typeof r.id!=='string'||!messageUuid.test(r.id)||r.conversation_id!==target||![thread.ownerId,thread.requesterId].includes(r.sender_id as string)||!validPersistedMessageBody(r.body)||!createdAt||createdAt<thread.createdAt)return fail();
   if(previous&&!(createdAt<previous.createdAt||(createdAt===previous.createdAt&&r.id<previous.id)))return fail();previous={createdAt,id:r.id};
   return {id:r.id,senderId:r.sender_id as string,body:r.body,createdAt};
  });
  // Re-read after messages to avoid returning a retained participant snapshot
  // when access was revoked or the thread disappeared during the page read.
  const fresh=await ports.thread(target);if(fresh===null)return {status:'missing'};const currentThread=projectMessageThread(fresh,target,viewer);if(!currentThread||currentThread.requestId!==thread.requestId||currentThread.ownerId!==thread.ownerId||currentThread.requesterId!==thread.requesterId||currentThread.createdAt!==thread.createdAt)return fail();
  let sendStatus:'available'|'closed'|'unavailable'='closed';
  if(!currentThread.closed){
   const connection=await ports.connection(thread.requestId);
   if(connection.status==='unauthenticated'||connection.status==='forbidden')return {status:connection.status};
   if(connection.status==='unavailable')sendStatus='unavailable';
   else if(connection.status==='authorized'){
    const c=connection.connection;if(c.requestId!==thread.requestId||c.ownerId!==thread.ownerId||c.requesterId!==thread.requesterId||c.counterpartId!==(viewer===thread.ownerId?thread.requesterId:thread.ownerId)||c.isOwner!==(viewer===thread.ownerId))return fail();sendStatus='available';
   }
  }
  const deletedPilot=await ports.deleted?.(target);
  const current=await ports.access();if(current.status!=='authorized')return {status:current.status};if(current.member.userId!==viewer)return {status:'forbidden'};
  const visible=rows.slice(0,30),last=visible.at(-1);
  return {status:'authorized',...(deletedPilot?{deletedPilot:true}:{}),conversation:{id:target,requestId:thread.requestId,counterpartId:viewer===thread.ownerId?thread.requesterId:thread.ownerId,closed:currentThread.closed},messages:visible.reverse(),olderCursor:rows.length>30&&last?`${last.createdAt}~${last.id}`:null,sendStatus};
 }catch{return {status:'unavailable'};}
}
