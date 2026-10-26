'use client';
import {useActionState,useEffect,useRef,useState,useTransition} from 'react';
import {emptyMemberDisableForm,memberDisableFormResult,type MemberDisableFormState} from '../../../../lib/auth/member-admin-form-state';
import {disableAdminMember} from './actions';
export default function MemberControl({targetId,disabled,after}:{targetId:string;disabled:boolean;after?:string}){
 const permalink='/admin/members'+(after?'?after='+after:'')+'#member-'+targetId;
 const [nativeState,submit,nativePending]=useActionState(disableAdminMember,emptyMemberDisableForm,permalink),[clientState,setClientState]=useState<MemberDisableFormState|null>(null),[sending,start]=useTransition();
 const state=clientState??nativeState,pending=sending||nativePending,feedback=useRef<HTMLParagraphElement>(null),inFlight=useRef(false);
 const [count,setCount]=useState({revision:0,value:0});
 useEffect(()=>{if(state.revision>0&&!pending)feedback.current?.focus();},[state.revision,pending]);
 const editable=!disabled&&['ready','invalid'].includes(state.status),frozen=state.status==='unconfirmed'||state.status==='denied';
 return <div className="space-y-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
  {state.message&&!pending&&<p ref={feedback} tabIndex={-1} role={state.status==='disabled'?'status':'alert'} className="rounded-lg border border-zinc-300 p-3 focus-visible:outline-2 focus-visible:outline-offset-4 dark:border-zinc-700">{state.message}</p>}
  {editable&&<form action={submit} aria-busy={pending} onSubmit={event=>{
   event.preventDefault();if(inFlight.current)return;inFlight.current=true;const form=new FormData(event.currentTarget);
   start(async()=>{try{setClientState(await disableAdminMember(state,form));}catch{setClientState(memberDisableFormResult(state,form,{code:'disable_unconfirmed'}));}finally{inFlight.current=false;}});
  }} className="space-y-4">
   <fieldset key={state.revision} disabled={pending} className="min-w-0 space-y-4">
    <legend className="sr-only">Disable member {targetId}</legend><input type="hidden" name="target_id" value={targetId}/>
    <div className="space-y-2"><label htmlFor={'reason-'+targetId} className="block font-medium">Reason for disabling</label><p id={'help-'+targetId} className="text-sm">Required, up to 500 characters. The reason is recorded in the administration audit.</p>
     <textarea id={'reason-'+targetId} name="reason" required maxLength={1000} rows={3} defaultValue={state.reason} aria-describedby={'help-'+targetId+' count-'+targetId} aria-invalid={state.status==='invalid'?true:undefined}
      onChange={event=>{const value=[...event.currentTarget.value.replace(/\r\n?/g,'\n')].length;setCount({revision:state.revision,value});event.currentTarget.setCustomValidity(value>500?'Use no more than 500 characters.':'');}}
      className="w-full min-w-0 rounded-lg border border-zinc-300 bg-transparent p-3 focus-visible:outline-2 focus-visible:outline-offset-4 dark:border-zinc-700"/>
     <p id={'count-'+targetId} className="text-sm">{count.revision===state.revision?count.value:[...state.reason].length} / 500 characters</p>
    </div>
    <label className="flex min-h-11 items-start gap-3 py-2"><input type="checkbox" name="confirmation" value="disable" required className="mt-1 h-5 w-5 shrink-0"/><span>I confirm this member should lose protected access. Their account and retained data will not be deleted.</span></label>
    <button type="submit" className="min-h-11 rounded-lg bg-zinc-900 px-5 py-3 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900">{pending?'Disabling member…':'Disable member'}</button>
   </fieldset>
  </form>}
  {pending&&<p role="status">Disabling member…</p>}
  {(frozen||state.status==='disabled')&&<form action={'/admin/members#member-'+targetId} method="get">{after&&<input type="hidden" name="after" value={after}/>}<button className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Check member status</button></form>}
  {disabled&&state.status!=='disabled'&&<p>No disable action is available for this disabled member.</p>}
 </div>;
}
