import {messageInstant,messageUuid} from './validation.ts';
import {parseMessageInput} from './input.ts';
export type ComposerState={revision:number;status:'editing'|'sent'|'unconfirmed'|'denied'|'invalid';messageId:string;body:string;notice:string|null};
/** Fixed feedback only. A new UUID is used only after exact confirmed success. */
export function composerResult(previous:ComposerState,form:FormData,result:unknown,nextId:string):ComposerState{
 const revision=Number.isSafeInteger(previous?.revision)&&previous.revision>=0&&previous.revision<1000000?previous.revision+1:1;
 const raw=form.get('body'),body=typeof raw==='string'?[...raw.replace(/\r\n?/g,'\n')].slice(0,4001).join(''):'';
 const submittedId=form.get('message_id'),messageId=typeof submittedId==='string'&&messageUuid.test(submittedId)?submittedId:previous.messageId;
 const parsed=parseMessageInput({conversation_id:form.get('conversation_id'),message_id:submittedId,body:raw});
 const value=result&&typeof result==='object'&&!Array.isArray(result)?result as Record<string,unknown>:{};
 if(parsed&&value.code==='sent'&&value.id===parsed.messageId&&value.conversationId===parsed.conversationId&&typeof value.senderId==='string'&&messageUuid.test(value.senderId)&&messageInstant(value.createdAt)&&messageUuid.test(nextId)&&nextId!==parsed.messageId)return {revision,status:'sent',messageId:nextId,body:'',notice:'Message sent.'};
 const status=['forbidden','unauthenticated','conversation_unavailable'].includes(value.code as string)?'denied':['invalid_input','too_large'].includes(value.code as string)?'invalid':'unconfirmed';
 const notice={denied:'Sending is no longer available. Refresh this conversation to check its current status.',invalid:'Enter a message with 1–4,000 characters. Whitespace alone is not a message.',unconfirmed:'We could not confirm whether this message was sent. Retry the same message to avoid sending a duplicate.'}[status];
 return {revision,status,messageId,body,notice};
}
