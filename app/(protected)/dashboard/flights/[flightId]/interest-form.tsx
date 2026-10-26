'use client';
import Link from 'next/link';
import {useActionState,useEffect,useRef,useState} from 'react';
import {emptyInterestForm} from '../../../../../lib/flights/interest-form-state';
import {requestInterest} from './actions';
export type InterestMode='ready'|'resubmit'|'pending'|'accepted'|'closed'|'flight_unavailable'|'profile_required'|'error';
const linkClass='inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4';
const initialMessages:Record<InterestMode,string|null>={ready:null,resubmit:'You withdrew your previous request. You can submit it again.',pending:'Request pending. The posting pilot will review your interest.',accepted:'Your request has been accepted.',closed:'This request is closed and cannot be submitted again.',flight_unavailable:'This flight is unavailable for new interest.',profile_required:'Complete your pilot profile before requesting a flight.',error:'Request status temporarily unavailable. Check request status before submitting.'};
export default function InterestForm({flightId,mode}:{flightId:string;mode:InterestMode}){
 const permalink=`/dashboard/flights/${flightId}`;
 const [state,submit,pending]=useActionState(requestInterest,emptyInterestForm,permalink);
 const [withdrawing,setWithdrawing]=useState(false);
 const [count,setCount]=useState({revision:0,value:0}),feedback=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{if(state.revision>0)feedback.current?.focus();},[state.revision]);
 const status=mode==='closed'?'closed':state.revision>0?state.status:mode;
 const canResubmit=status==='withdrawn'&&!['flight_unavailable','profile_required','error','closed'].includes(mode);
 const editing=['ready','resubmit','editing'].includes(status)||canResubmit,unconfirmed=status==='unconfirmed';
 const message=mode==='closed'?initialMessages.closed:state.revision>0?state.message:initialMessages[mode];
 const error=['error','unconfirmed','withdrawal_unconfirmed','stale','denied','flight_unavailable','editing'].includes(status)&&message!==null;
 return <section aria-labelledby="flight-interest-heading" className="min-w-0 space-y-4 border-t border-zinc-200 pt-6">
  <h2 id="flight-interest-heading" className="text-xl font-semibold">Join this flight</h2>
  {message&&<p id="interest-feedback" ref={feedback} tabIndex={-1} role={error?'alert':'status'} className="rounded-lg border border-zinc-300 p-4 focus-visible:outline-2 focus-visible:outline-offset-2">{message}</p>}
  {pending&&<p role="status">{withdrawing?'Withdrawing your request…':'Sending your interest…'}</p>}
  {status==='withdrawn'&&!canResubmit&&<p>{initialMessages[mode]}</p>}
  {(editing||unconfirmed)&&<form action={submit} onSubmit={()=>setWithdrawing(false)} aria-busy={pending} className="space-y-4">
   <fieldset disabled={pending||unconfirmed} className="min-w-0 space-y-4">
    <legend className="sr-only">Express interest in this flight</legend>
    <input type="hidden" name="flight_id" value={flightId}/>
    <div className="space-y-2">
     <label htmlFor="interest-note" className="block font-medium">Introduction (optional)</label>
     <p id="interest-note-help" className="text-sm text-zinc-600">Introduce yourself to the posting pilot. Up to 500 characters.</p>
     <textarea key={state.revision} id="interest-note" name="introductory_note" rows={4} maxLength={1000} defaultValue={state.note}
      aria-describedby={`interest-note-help interest-note-count${status==='editing'&&state.message?' interest-feedback':''}`} aria-invalid={status==='editing'&&state.message?true:undefined}
      onChange={event=>{const length=[...event.currentTarget.value].length;setCount({revision:state.revision,value:length});event.currentTarget.setCustomValidity(length>500?'Use no more than 500 characters.':'');}}
      className="w-full min-w-0 rounded-lg border border-zinc-300 bg-transparent px-3 py-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"/>
     <p id="interest-note-count" className="text-sm text-zinc-600">{count.revision===state.revision?count.value:[...state.note].length} / 500 characters</p>
    </div>
    <button type="submit" className="min-h-11 rounded-lg bg-zinc-900 px-5 py-3 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-60">{pending?'Sending interest…':mode==='resubmit'||status==='withdrawn'?'Submit interest again':'Interested'}</button>
   </fieldset>
  </form>}
  {['pending','accepted'].includes(status)&&<form action={submit} onSubmit={()=>setWithdrawing(true)} aria-busy={pending} className="space-y-3">
   {status==='accepted'&&<p>Withdrawing frees your place. If you submit interest again, you will need fresh approval from the posting pilot.</p>}
   <fieldset disabled={pending}>
    <legend className="sr-only">Withdraw your flight request</legend>
    <input type="hidden" name="flight_id" value={flightId}/><input type="hidden" name="intent" value="withdraw"/>
    <button type="submit" className="min-h-11 rounded-lg border border-zinc-400 px-5 py-3 font-medium focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-60">{pending&&withdrawing?'Withdrawing request…':'Withdraw request'}</button>
   </fieldset>
  </form>}
  {(status==='profile_required'||(status==='withdrawn'&&mode==='profile_required'))&&<Link href="/onboarding" prefetch={false} className={linkClass}>Complete your pilot profile</Link>}
  {!editing&&!['pending','accepted','closed','profile_required'].includes(status)&&<form action={permalink} method="get"><button type="submit" className={linkClass}>Check request status</button></form>}
 </section>;
}
