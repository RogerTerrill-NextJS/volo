import 'server-only';
import type {MutationPolicy} from '../auth/mutation.ts';
import {parseMessageInput,type MessageInput} from './input.ts';
import {messageInstant,projectMessageThread} from './validation.ts';
export type SendResult={code:'sent';id:string;conversationId:string;senderId:string;createdAt:string}|{code:'conversation_unavailable'|'unavailable'|'send_unconfirmed'|'forbidden'|'invalid_input'};
export type SendPorts={thread:(id:string)=>Promise<unknown>;send:(input:MessageInput)=>Promise<{data:unknown;error:{code?:string}|null}>};
function createPorts():SendPorts{
 const client=()=>import('../flights/client.ts').then(m=>m.flightMutationClient());
 return {
  async thread(id){const result=await(await client()).from('conversations').select('id,flight_request_id,owner_id,requester_id,created_at,closed_at').eq('id',id).retry(false).maybeSingle();if(result.error)throw Error('Conversation unavailable');return result.data;},
  async send(input){return(await client()).rpc('send_conversation_message',{p_conversation_id:input.conversationId,p_message_id:input.messageId,p_body:input.body}).retry(false);},
 };
}
/** Final writable authority and sender come from the locked session-only RPC. */
export function messageSendPolicy(ports:SendPorts=createPorts()):MutationPolicy<MessageInput,SendResult>{return {
 allowedRoles:['member','admin'],
 parse(raw){const value=parseMessageInput(raw);return value?{ok:true,value}:{ok:false};},
 authorize(){return true;},
 async effect(member,input){
  let thread;
  try{thread=projectMessageThread(await ports.thread(input.conversationId),input.conversationId,member.userId);}catch{return {code:'unavailable'};}
  if(!thread||thread.closed)return {code:'conversation_unavailable'};
  // No automatic resend: a transport failure can occur after a committed insert.
  // An explicit retry must keep this message UUID, conversation and exact body.
  try{
   const {data,error}=await ports.send(input);
   if(error)return {code:error.code==='42501'?'forbidden':error.code==='22023'?'invalid_input':'send_unconfirmed'};
   if(!data||typeof data!=='object'||Array.isArray(data))return {code:'send_unconfirmed'};
   const result=data as Record<string,unknown>,createdAt=messageInstant(result.createdAt);
   if(result.id!==input.messageId||result.conversationId!==input.conversationId||result.senderId!==member.userId||!createdAt||createdAt<thread.createdAt)return {code:'send_unconfirmed'};
   return {code:'sent',id:input.messageId,conversationId:input.conversationId,senderId:member.userId,createdAt};
  }catch{return {code:'send_unconfirmed'};}
 },
};}
