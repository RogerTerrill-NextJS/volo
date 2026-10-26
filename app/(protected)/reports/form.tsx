'use client';
import {useActionState,useEffect,useRef,useState,useTransition} from 'react';
import {emptyReportForm,reportFormResult,type ReportFormState} from '../../../lib/reports/form-state';
import {reportHref} from '../../../lib/reports/links';
import type {ReportTarget} from '../../../lib/reports/validation';
import {sendReport} from './actions';
export default function ReportForm({reportId,targetType,targetId,receivedAt}:{reportId:string;targetType:ReportTarget;targetId:string;receivedAt:string|null}){
 const permalink=reportHref(targetType,targetId,reportId)??'/reports';
 const [nativeState,submit,nativePending]=useActionState(sendReport,emptyReportForm,permalink),[clientState,setClientState]=useState<ReportFormState|null>(null),[sending,start]=useTransition();
 const state=clientState??nativeState,pending=sending||nativePending,feedback=useRef<HTMLParagraphElement>(null),inFlight=useRef(false),[count,setCount]=useState({revision:0,value:0});
 useEffect(()=>{if(state.revision>0&&!pending)feedback.current?.focus();},[state.revision,pending]);
 const confirmed=state.status==='received'||(state.revision===0&&receivedAt!==null),editable=!receivedAt&&['ready','invalid'].includes(state.status),frozen=['denied','unconfirmed'].includes(state.status);
 return <section className="min-w-0 space-y-5" aria-label="Report submission">
  {(state.message||confirmed)&&!pending&&<p ref={feedback} tabIndex={-1} role={confirmed?'status':'alert'} className="rounded-lg border border-zinc-300 p-4 focus-visible:outline-2 focus-visible:outline-offset-4 dark:border-zinc-700">{state.message??'Report received. The founder reviews reports manually during beta.'}</p>}
  {confirmed&&<p className="text-sm [overflow-wrap:anywhere]">Report reference: {reportId}</p>}
  {editable&&<form action={submit} aria-busy={pending} onSubmit={event=>{
   event.preventDefault();if(inFlight.current)return;inFlight.current=true;const form=new FormData(event.currentTarget);
   start(async()=>{try{setClientState(await sendReport(state,form));}catch{setClientState(reportFormResult(state,form,{code:'report_unconfirmed'}));}finally{inFlight.current=false;}});
  }} className="space-y-4">
   <fieldset key={state.revision} disabled={pending} className="min-w-0 space-y-4"><legend className="sr-only">Report this {targetType}</legend>
    <input type="hidden" name="report_id" value={reportId}/><input type="hidden" name="target_type" value={targetType}/><input type="hidden" name="target_id" value={targetId}/>
    <div className="space-y-2"><label htmlFor="report-reason" className="block font-medium">What is your concern?</label><p id="report-help" className="text-sm">Required, up to 2,000 characters. Include the context needed for review. Do not include passwords or unrelated personal information.</p>
     <textarea id="report-reason" name="reason" required maxLength={4000} rows={6} defaultValue={state.reason} aria-describedby="report-help report-count" aria-invalid={state.status==='invalid'?true:undefined}
      onChange={event=>{const value=[...event.currentTarget.value.replace(/\r\n?/g,'\n')].length;setCount({revision:state.revision,value});event.currentTarget.setCustomValidity(value>2000?'Use no more than 2,000 characters.':'');}}
      className="w-full min-w-0 rounded-lg border border-zinc-300 bg-transparent p-3 focus-visible:outline-2 focus-visible:outline-offset-4 dark:border-zinc-700"/>
     <p id="report-count" className="text-sm">{count.revision===state.revision?count.value:[...state.reason].length} / 2,000 characters</p>
    </div>
    <button type="submit" className="min-h-11 rounded-lg bg-zinc-900 px-5 py-3 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900">{pending?'Sending report…':'Send report'}</button>
   </fieldset>
  </form>}
  {pending&&<p role="status">Sending report…</p>}
  {frozen&&<form action="/reports" method="get"><input type="hidden" name="target_type" value={targetType}/><input type="hidden" name="target_id" value={targetId}/><input type="hidden" name="report_id" value={reportId}/><button className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Check report status</button></form>}
 </section>;
}
