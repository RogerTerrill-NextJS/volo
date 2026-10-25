import 'server-only';
import type {MutationPolicy} from '../auth/mutation.ts';
import type {ConnectionResult} from '../flights/connection-query.ts';
import {messageUuid,projectMessageThread} from './validation.ts';
type OpenInput={requestId:string};
export type OpenResult={code:'opened';conversationId:string}|{code:'conversation_unavailable'|'unavailable'|'forbidden'|'unauthenticated'};
export type OpenPorts={connection:(id:string)=>Promise<ConnectionResult>;open:(id:string)=>Promise<{data:unknown;error:{code?:string}|null}>;thread:(id:string)=>Promise<unknown>};
function createPorts():OpenPorts{
 const client=()=>import('../flights/client.ts').then(m=>m.flightMutationClient());
 return {
  connection:async id=>(await import('../flights/connection-query.ts')).getFlightConnection(id),
  async open(id){return(await client()).rpc('get_or_create_flight_conversation',{p_request_id:id}).retry(false);},
  async thread(id){const result=await(await client()).from('conversations').select('id,flight_request_id,owner_id,requester_id,created_at,closed_at').eq('id',id).retry(false).maybeSingle();if(result.error)throw Error('Conversation unavailable');return result.data;},
 };
}
/** A POST opens the request's existing pair; conversation identity and participants are server-derived. */
export function conversationOpenPolicy(ports:OpenPorts=createPorts()):MutationPolicy<OpenInput,OpenResult>{return {
 allowedRoles:['member','admin'],
 parse(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {ok:false};
  const r=raw as Record<string,unknown>;
  if(Object.keys(r).length!==1||typeof r.request_id!=='string'||!messageUuid.test(r.request_id.toLowerCase()))return {ok:false};
  return {ok:true,value:{requestId:r.request_id.toLowerCase()}};
 },
 authorize(){return true;},
 async effect(member,input){
  try{
   const first=await ports.connection(input.requestId);
   if(first.status!=='authorized')return {code:first.status==='missing'?'conversation_unavailable':first.status};
   const pair=first.connection;
   if(pair.requestId!==input.requestId||![pair.ownerId,pair.requesterId].includes(member.userId))return {code:'conversation_unavailable'};
   // The locked, idempotent RPC rechecks live acceptance, PRIVATE selection and both memberships.
   const {data,error}=await ports.open(input.requestId);
   if(error)return {code:error.code==='42501'?'conversation_unavailable':'unavailable'};
   if(typeof data!=='string'||!messageUuid.test(data))return {code:'unavailable'};
   const thread=projectMessageThread(await ports.thread(data),data,member.userId);
   if(!thread||thread.closed||thread.requestId!==input.requestId||thread.ownerId!==pair.ownerId||thread.requesterId!==pair.requesterId)return {code:'conversation_unavailable'};
   const current=await ports.connection(input.requestId);
   if(current.status!=='authorized')return {code:current.status==='missing'?'conversation_unavailable':current.status};
   if(Object.keys(pair).some(key=>pair[key as keyof typeof pair]!==current.connection[key as keyof typeof pair]))return {code:'conversation_unavailable'};
   return {code:'opened',conversationId:data};
  }catch{return {code:'unavailable'};}
 },
};}
