'use client';
import {useActionState,useEffect,useRef} from 'react';
import {emptyCancellationForm} from '../../../../../lib/flights/cancellation-form-state';
import {cancelFlight} from './actions';
const buttonClass='min-h-11 rounded-lg border border-zinc-400 px-4 py-3 font-medium focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-60 dark:border-zinc-600';
export default function CancellationForm({flightId,flightStatus}:{flightId:string;flightStatus:'open'|'cancelled'|'completed'}){
 const permalink=`/dashboard/flights/${flightId}`;
 const [state,submit,pending]=useActionState(cancelFlight,emptyCancellationForm,permalink);
 const feedback=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{if(state.revision>0)feedback.current?.focus();},[state.revision]);
 if(flightStatus!=='open'&&state.revision===0)return null;
 const blocked=state.status!=='ready',success=state.status==='cancelled';
 return <section aria-labelledby="cancel-flight-heading" className="min-w-0 space-y-4 rounded-xl border border-zinc-300 p-5 dark:border-zinc-700">
  <h2 id="cancel-flight-heading" className="text-xl font-semibold">Cancel flight</h2>
  {state.message&&<p ref={feedback} tabIndex={-1} role={success?'status':'alert'} className="rounded-lg border border-zinc-300 p-4 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700">{state.message}</p>}
  {pending&&<p role="status">Cancelling your flight. Please wait.</p>}
  {!success&&<>
   <p id="cancel-flight-help">Cancellation closes all pending and accepted requests and removes this flight from upcoming flights. Flight and request history are retained. To fly a new plan, post a new flight.</p>
   <form action={submit} aria-label="Confirm flight cancellation" aria-busy={pending} className="space-y-4" key={state.revision}>
    <fieldset disabled={pending||blocked||flightStatus!=='open'} className="min-w-0 space-y-4">
     <legend className="sr-only">Confirm flight cancellation</legend>
     <input type="hidden" name="flight_id" value={flightId}/><input type="hidden" name="intent" value="cancel"/>
     <label className="flex min-h-11 items-start gap-3 py-2" htmlFor="cancel-flight-confirmation">
      <input id="cancel-flight-confirmation" name="confirmation" type="checkbox" value="cancel" required aria-describedby="cancel-flight-help" className="mt-1 h-5 w-5 shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4"/>
      <span>I confirm cancellation of this flight and closure of its active requests.</span>
     </label>
     <div className="flex flex-wrap gap-3">
      <button type="submit" className={`${buttonClass} bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900`}>{pending?'Cancelling flight…':'Confirm cancellation'}</button>
      <button type="reset" className={buttonClass}>Keep flight</button>
     </div>
    </fieldset>
   </form>
  </>}
  {blocked&&!success&&<form action={permalink} method="get"><button type="submit" className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Check flight status</button></form>}
 </section>;
}
