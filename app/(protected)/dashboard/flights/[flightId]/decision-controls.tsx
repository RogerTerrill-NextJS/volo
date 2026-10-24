'use client';
import {useActionState,useEffect,useRef} from 'react';
import {emptyDecisionForm} from '../../../../../lib/flights/decision-form-state';
import type {RequestStatus} from '../../../../../lib/flights/interest-query';
import {decideRequest} from './actions';
const labels={pending:'Pending',accepted:'Accepted',declined:'Declined',withdrawn:'Withdrawn',cancelled:'Cancelled'};
const buttonClass='min-h-11 rounded-lg border border-zinc-400 px-4 py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-60 dark:border-zinc-600';
export default function DecisionControls({flightId,requestId,initialStatus,permalink,pilotName}:{flightId:string;requestId:string;initialStatus:RequestStatus;permalink:string;pilotName:string}){
 const [state,submit,pending]=useActionState(decideRequest,emptyDecisionForm,permalink),feedback=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{if(state.revision>0)feedback.current?.focus();},[state.revision]);
 const confirmed=state.status==='accepted'||state.status==='declined';
 const status=initialStatus==='pending'&&confirmed?state.status as 'accepted'|'declined':initialStatus;
 const changed=(confirmed&&initialStatus!=='pending'&&initialStatus!==state.status)||(state.status==='full'&&initialStatus!=='pending');
 const blocked=changed||['stale','unconfirmed','denied'].includes(state.status);
 const message=changed?'This request has changed. Check request status.':state.message;
 const reload=state.revision>0&&(blocked||state.status==='full');
 const [page,fragment]=permalink.split('#'),[route,query]=page.split('?');
 const requestsAfter=new URLSearchParams(query).get('requestsAfter');
 return <div className="min-w-0 space-y-3">
  <p className="w-fit rounded-full border border-zinc-400 px-3 py-1 text-sm font-semibold dark:border-zinc-600">{labels[status]}</p>
  {message&&<p ref={feedback} tabIndex={-1} role={confirmed&&!changed?'status':'alert'} className="max-w-prose rounded-lg border border-zinc-300 p-3 [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700">{message}</p>}
  {pending&&<p role="status">Saving your decision…</p>}
  {status==='pending'&&<form action={submit} aria-busy={pending}>
   <fieldset disabled={pending||blocked} className="flex min-w-0 flex-wrap gap-3">
    <legend className="sr-only">Decision for {pilotName}</legend>
    <input type="hidden" name="flight_id" value={flightId}/><input type="hidden" name="request_id" value={requestId}/>
    <button type="submit" name="decision" value="accepted" disabled={state.status==='full'} className={`${buttonClass} bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900`}>Accept</button>
    <button type="submit" name="decision" value="declined" className={buttonClass}>Decline</button>
   </fieldset>
  </form>}
  {reload&&<form action={`${route}#${fragment}`} method="get">
   {requestsAfter&&<input type="hidden" name="requestsAfter" value={requestsAfter}/>}
   <button type="submit" className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Check request status</button>
  </form>}
 </div>;
}
