import {messageUuid,validMessageBody} from './validation.ts';
export type MessageInput={conversationId:string;messageId:string;body:string};
/** Identity and retry payload are explicit; sender and timestamp are never inputs. */
export function parseMessageInput(raw:unknown):MessageInput|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))return null;
 const r=raw as Record<string,unknown>;
 // Native multipart forms normalize line endings; use one payload for both action transports.
 const body=typeof r.body==='string'?r.body.replace(/\r\n?/g,'\n'):r.body;
 if(Object.keys(r).some(key=>!['conversation_id','message_id','body'].includes(key))||typeof r.conversation_id!=='string'||typeof r.message_id!=='string'||!messageUuid.test(r.conversation_id.toLowerCase())||!messageUuid.test(r.message_id.toLowerCase())||!validMessageBody(body))return null;
 return {conversationId:r.conversation_id.toLowerCase(),messageId:r.message_id.toLowerCase(),body};
}
