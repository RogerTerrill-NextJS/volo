'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {passwordSetupError} from '../../../lib/auth/invitation-setup-feedback';

export default function PasswordSetupForm({csrf,message,purpose='invitation'}:{csrf:string;message:string|null;purpose?:'invitation'|'recovery'}) {
 const form=useRef<HTMLFormElement>(null),alert=useRef<HTMLParagraphElement>(null),submitting=useRef(false);
 const [pending,setPending]=useState(false),[error,setError]=useState<string|null>(null);
 useEffect(()=>{
  const reset=()=>{form.current?.reset();submitting.current=false;setPending(false);setError(null);};
  reset();window.addEventListener('pageshow',reset);return ()=>window.removeEventListener('pageshow',reset);
 },[]);
 useEffect(()=>{if(error||message)alert.current?.focus();},[error,message]);
 function submit(event:FormEvent<HTMLFormElement>){
  if(submitting.current){event.preventDefault();return;}
  const fields=new FormData(event.currentTarget),feedback=passwordSetupError(String(fields.get('password')??''),String(fields.get('passwordConfirmation')??''));
  if(feedback){event.preventDefault();setError(feedback);return;}
  submitting.current=true;setError(null);setPending(true);
 }
 const input='w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700';
 return <form ref={form} action={purpose==='recovery'?'/auth/reset-password':'/account/complete'} method="post" onSubmit={submit} className="space-y-5" aria-busy={pending}>
  <input type="hidden" name="csrf" value={csrf}/>
  <div className="space-y-2">
   <label htmlFor="setup-password" className="block text-sm font-medium">Password</label>
   <input id="setup-password" name="password" type="password" autoComplete="new-password" required maxLength={256} aria-describedby="password-help setup-feedback" aria-invalid={error?true:undefined} className={input}/>
   <p id="password-help" className="text-sm text-zinc-600 dark:text-zinc-400">Use at least 8 characters.</p>
  </div>
  <div className="space-y-2">
   <label htmlFor="setup-confirmation" className="block text-sm font-medium">Confirm password</label>
   <input id="setup-confirmation" name="passwordConfirmation" type="password" autoComplete="new-password" required maxLength={256} aria-describedby="setup-feedback" aria-invalid={error?true:undefined} className={input}/>
  </div>
  <p ref={alert} id="setup-feedback" role={error||message?'alert':undefined} tabIndex={-1} className="text-sm text-zinc-700 empty:hidden dark:text-zinc-300">{error??message}</p>
  <button type="submit" disabled={pending} className="w-full rounded-lg bg-zinc-900 px-4 py-3 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900">{purpose==='recovery'?(pending?'Resetting password…':'Reset password'):(pending?'Completing account…':'Complete account')}</button>
  <p role="status" className="text-sm empty:hidden">{pending?(purpose==='recovery'?'Resetting your password. Please wait.':'Setting up your account. Please wait.'):''}</p>
 </form>;
}
