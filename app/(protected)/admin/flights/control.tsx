'use client';
import {useActionState,useEffect,useRef,useState,useTransition} from 'react';
import {emptyModerationForm,moderationFormResult,type ModerationFormState} from '../../../../lib/flights/moderation-form-state';
import {hideAdminFlight} from './actions';
export default function ModerationControl({flightId,hidden,after}:{flightId:string;hidden:boolean;after?:string}){
 const permalink='/admin/flights'+(after?'?after='+after:'')+'#flight-'+flightId;
 const [nativeState,submit,nativePending]=useActionState(hideAdminFlight,emptyModerationForm,permalink),[clientState,setClientState]=useState<ModerationFormState|null>(null),[sending,start]=useTransition();
 const state=clientState??nativeState,pending=sending||nativePending,feedback=useRef<HTMLParagraphElement>(null),inFlight=useRef(false);
 const [count,setCount]=useState({revision:0,value:0});
 useEffect(()=>{if(state.revision>0&&!pending)feedback.current?.focus();},[state.revision,pending]);
 const editable=!hidden&&['ready','invalid'].includes(state.status),frozen=state.status==='unconfirmed'||state.status==='denied';
 return <div className="space-y-4 border-t border-zinc-200 pt-4">
  {state.message&&!pending&&<p ref={feedback} tabIndex={-1} role={state.status==='hidden'?'status':'alert'} className="rounded-lg border border-zinc-300 p-3 focus-visible:outline-2 focus-visible:outline-offset-4">{state.message}</p>}
  {editable&&<form action={submit} aria-busy={pending} onSubmit={event=>{
   event.preventDefault();if(inFlight.current)return;inFlight.current=true;const form=new FormData(event.currentTarget);
   start(async()=>{try{setClientState(await hideAdminFlight(state,form));}catch{setClientState(moderationFormResult(state,form,{code:'moderation_unconfirmed'}));}finally{inFlight.current=false;}});
  }} className="space-y-4">
   <fieldset key={state.revision} disabled={pending} className="min-w-0 space-y-4">
    <legend className="sr-only">Hide flight {flightId}</legend><input type="hidden" name="flight_id" value={flightId}/>
    <div className="space-y-2"><label htmlFor={'reason-'+flightId} className="block font-medium">Reason for hiding</label><p id={'help-'+flightId} className="text-sm">Required, up to 500 characters. The reason is recorded in the moderation audit.</p>
     <textarea id={'reason-'+flightId} name="reason" required maxLength={1000} rows={3} defaultValue={state.reason} aria-describedby={'help-'+flightId+' count-'+flightId} aria-invalid={state.status==='invalid'?true:undefined}
      onChange={event=>{const value=[...event.currentTarget.value.replace(/\r\n?/g,'\n')].length;setCount({revision:state.revision,value});event.currentTarget.setCustomValidity(value>500?'Use no more than 500 characters.':'');}}
      className="w-full min-w-0 rounded-lg border border-zinc-300 bg-transparent p-3 focus-visible:outline-2 focus-visible:outline-offset-4"/>
     <p id={'count-'+flightId} className="text-sm">{count.revision===state.revision?count.value:[...state.reason].length} / 500 characters</p>
    </div>
    <label className="flex min-h-11 items-start gap-3 py-2"><input type="checkbox" name="confirmation" value="hide" required className="mt-1 h-5 w-5 shrink-0"/><span>I confirm this flight should be hidden. Active requests will close and further messages cannot be sent. Post and conversation history will be retained.</span></label>
    <button type="submit" className="min-h-11 rounded-lg bg-zinc-900 px-5 py-3 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-60">{pending?'Hiding flight…':'Hide flight'}</button>
   </fieldset>
  </form>}
  {pending&&<p role="status">Hiding flight…</p>}
  {(frozen||state.status==='hidden')&&<form action={'/admin/flights#flight-'+flightId} method="get">{after&&<input type="hidden" name="after" value={after}/>}<button className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Check flight status</button></form>}
  {hidden&&state.status!=='hidden'&&<p>This flight is hidden. No further hide action is available.</p>}
 </div>;
}
