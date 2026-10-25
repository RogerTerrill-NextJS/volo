'use client';
import {useActionState,useEffect,useRef,useTransition} from 'react';
import {composerResult,type ComposerState} from '../../../../lib/messages/composer-state';
import {sendChatMessage} from './actions';
import {useConversationDraft} from './draft';
export default function Composer({conversationId,initialMessageId,viewerId}:{conversationId:string;initialMessageId:string;viewerId:string}){
 const permalink=`/messages/${conversationId}`;
 const initial:ComposerState={revision:0,status:'editing',body:'',messageId:initialMessageId,notice:null};
 const [nativeState,submit,nativePending]=useActionState(sendChatMessage,initial,permalink);
 const {draft,save}=useConversationDraft(),[sending,startSending]=useTransition();
 const stored=draft?.viewerId===viewerId?draft.state:null,state=stored??nativeState,pending=sending||nativePending,inFlight=useRef(false),feedback=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{if(nativeState.revision>0&&!stored)save(viewerId,nativeState);},[nativeState,stored,save,viewerId]);
 useEffect(()=>{if(state.revision>0&&!pending)feedback.current?.focus();},[state.revision,pending]);
 const uncertain=state.status==='unconfirmed',denied=state.status==='denied';
 return <section aria-labelledby="composer-heading" className="min-w-0 space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800">
  <h2 id="composer-heading" className="text-xl font-semibold">Write a message</h2>
  {state.notice&&!pending&&<p ref={feedback} tabIndex={-1} id="message-feedback" role={state.status==='sent'?'status':'alert'} className="rounded-lg border border-zinc-300 p-4 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700">{state.notice}</p>}
  <form action={submit} aria-busy={pending} onSubmit={event=>{
   event.preventDefault();if(inFlight.current||denied)return;
   const form=new FormData(event.currentTarget);inFlight.current=true;
   const uncertain=composerResult(state,form,{code:'send_unconfirmed'},state.messageId);save(viewerId,{...uncertain,revision:state.revision});
   startSending(async()=>{try{save(viewerId,await sendChatMessage(state,form));}catch{save(viewerId,composerResult(state,form,{code:'send_unconfirmed'},state.messageId));}finally{inFlight.current=false;}});
  }} className="space-y-4">
   <input type="hidden" name="conversation_id" value={conversationId}/><input type="hidden" name="message_id" value={state.messageId}/>
   <div className="space-y-2"><label htmlFor="message-body" className="block font-medium">Message</label>
    <p id="message-help" className="text-sm text-zinc-600 dark:text-zinc-400">Plain text only. Up to 4,000 characters. Enter adds a new line; use the send button to send.</p>
    <textarea key={state.revision} id="message-body" name="body" rows={5} maxLength={8000} required value={state.body} readOnly={pending||uncertain||denied}
     aria-describedby={`message-help message-count${state.notice?' message-feedback':''}`} aria-invalid={state.status==='invalid'?true:undefined}
     onChange={event=>{const length=[...event.currentTarget.value.replace(/\r\n?/g,'\n')].length;save(viewerId,{...state,body:event.currentTarget.value});event.currentTarget.setCustomValidity(length>4000?'Use no more than 4,000 characters.':'');}}
     className="w-full min-w-0 rounded-lg border border-zinc-300 bg-transparent p-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 read-only:opacity-70 dark:border-zinc-700"/>
    <p id="message-count" className="text-sm text-zinc-600 dark:text-zinc-400">{[...state.body].length} / 4,000 characters</p>
   </div>
   {!denied&&<button type="submit" disabled={pending} className="min-h-11 rounded-lg bg-zinc-900 px-5 py-3 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900">{pending?'Sending message…':uncertain?'Retry same message':'Send message'}</button>}
   {pending&&<p role="status">Sending your message…</p>}
  </form>
 </section>;
}
