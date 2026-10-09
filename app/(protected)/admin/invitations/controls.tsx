'use client';
import {useActionState} from 'react';
import {sendInvitation,renewInvitation,inspectInvitation} from './actions';

const button='rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900';
export function SendInvitationForm(){
 const [state,submit,pending]=useActionState(sendInvitation,{message:''});
 return <form action={submit} className="space-y-3 rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
  <h2 className="text-lg font-semibold">Send an invitation</h2>
  <label htmlFor="invitation-email" className="block text-sm font-medium">Recipient email</label>
  <div className="flex flex-wrap gap-3">
   <input id="invitation-email" type="email" name="email" required maxLength={254} autoComplete="email" className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700"/>
   <button disabled={pending} className={button}>{pending?'Sending…':'Send invitation'}</button>
  </div>
  <p role="status" className="text-sm">{state.message}</p>
 </form>;
}
export function InvitationControl({id,version,kind}:{id:string;version:number;kind:'renew'|'inspect'}){
 const [state,submit,pending]=useActionState(kind==='renew'?renewInvitation:inspectInvitation,{message:''});
 return <form action={submit} className="space-y-2">
  <input type="hidden" name="invitationId" value={id}/>
  <input type="hidden" name="expectedVersion" value={String(version)}/>
  <button disabled={pending} className={button}>{pending?'Working…':kind==='renew'?'Renew provider link':'Check send status'}</button>
  <p role="status" className="max-w-xs text-sm">{state.message}</p>
 </form>;
}
