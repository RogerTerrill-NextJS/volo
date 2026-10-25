'use client';
import {useActionState,useEffect,useRef} from 'react';
import {openConversation,type ContactState} from './actions';
const initial:ContactState={revision:0,retry:true,message:null};
export default function ContactForm({requestId}:{requestId:string}){
 const [state,submit,pending]=useActionState(openConversation,initial,`/dashboard/connections/${requestId}`),feedback=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{if(state.revision>0&&!pending)feedback.current?.focus();},[state.revision,pending]);
 return <section aria-labelledby="contact-pilot" className="min-w-0 space-y-4 rounded-2xl border border-zinc-200 p-5 sm:p-8 dark:border-zinc-800">
  <h2 id="contact-pilot" className="text-2xl font-semibold">Contact your connected pilot</h2>
  <p>Use your private flight conversation to coordinate with the other pilot.</p>
  {state.message&&!pending&&<p ref={feedback} tabIndex={-1} role="alert" className="focus-visible:outline-2 focus-visible:outline-offset-4">{state.message}</p>}
  {state.retry&&<form action={submit} aria-busy={pending}>
   <input type="hidden" name="request_id" value={requestId}/>
   <button type="submit" disabled={pending} className="min-h-11 rounded-lg bg-zinc-900 px-5 py-3 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900">{pending?'Opening conversation…':'Message pilot'}</button>
  </form>}
  {pending&&<p role="status">Opening your private conversation…</p>}
  {!state.retry&&<form action={`/dashboard/connections/${requestId}`} method="get"><button className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Check connection status</button></form>}
 </section>;
}
