'use client';
import {useActionState,useEffect,useRef,useState,useTransition} from 'react';
import {emptyOutcomeForm,outcomeFormResult,type OutcomeFormState} from '../../../../lib/outcomes/form-state';
import type {FlightOutcome} from '../../../../lib/outcomes/validation';
import {saveOutcome} from './actions';
export default function OutcomeForm({outcome,permalink}:{outcome:FlightOutcome;permalink:string}){
 const ownPermalink=permalink+'#outcome-'+outcome.requestId,after=new URL(permalink,'http://localhost').searchParams.get('after');
 const [nativeState,submit,nativePending]=useActionState(saveOutcome,emptyOutcomeForm,ownPermalink),[clientState,setClientState]=useState<OutcomeFormState|null>(null),[sending,start]=useTransition();
 const received=clientState??nativeState,state=received.requestId===outcome.requestId?received:emptyOutcomeForm,pending=sending||nativePending,locked=state.status==='saved'||state.status==='recover',inFlight=useRef(false),feedback=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{if(state.attempt>0&&!pending)feedback.current?.focus();},[state.attempt,pending]);
 return <section className="min-w-0 space-y-3" aria-label="Your flight outcome answer">
  {state.message&&!pending&&<p ref={feedback} tabIndex={-1} role={state.status==='saved'?'status':'alert'} className="rounded-lg border border-zinc-300 p-3 focus-visible:outline-2 focus-visible:outline-offset-4">{state.message}</p>}
  {!locked&&<form action={submit} aria-busy={pending} onSubmit={event=>{
   event.preventDefault();if(inFlight.current)return;inFlight.current=true;const form=new FormData(event.currentTarget);
   start(async()=>{try{setClientState(await saveOutcome(state,form));}catch{setClientState(outcomeFormResult(state,form,{code:'outcome_unconfirmed'}));}finally{inFlight.current=false;}});
  }} className="space-y-3">
   <fieldset disabled={pending} className="space-y-3"><legend className="font-semibold">Did you fly together on this flight?</legend>
    <input type="hidden" name="request_id" value={outcome.requestId}/><input type="hidden" name="expected_revision" value={outcome.revision}/>
    <label className="flex min-h-11 w-fit items-center gap-3"><input type="radio" name="answer" value="yes" required defaultChecked={outcome.answer===true} className="size-5"/>Yes</label>
    <label className="flex min-h-11 w-fit items-center gap-3"><input type="radio" name="answer" value="no" required defaultChecked={outcome.answer===false} className="size-5"/>No</label>
    <button type="submit" className="min-h-11 rounded-lg bg-zinc-900 px-5 py-3 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-60">{pending?'Saving answer…':outcome.answer===null?'Save answer':'Save corrected answer'}</button>
   </fieldset>
  </form>}
  {pending&&<p role="status">Saving answer…</p>}
  {locked&&<form action={ownPermalink} method="get">{after&&<input type="hidden" name="after" value={after}/>}<button className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">{state.status==='saved'?'Review or correct answer':'Check latest answer'}</button></form>}
 </section>;
}
