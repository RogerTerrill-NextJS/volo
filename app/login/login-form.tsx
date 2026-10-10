'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';

export default function LoginForm({message}:{message:string|null}){
 const form=useRef<HTMLFormElement>(null),alert=useRef<HTMLParagraphElement>(null),submitting=useRef(false);
 const [pending,setPending]=useState(false);
 useEffect(()=>{const reset=()=>{form.current?.reset();submitting.current=false;setPending(false);};reset();window.addEventListener('pageshow',reset);return()=>window.removeEventListener('pageshow',reset);},[]);
 useEffect(()=>{if(message)alert.current?.focus();},[message]);
 function submit(event:FormEvent<HTMLFormElement>){if(submitting.current){event.preventDefault();return;}submitting.current=true;setPending(true);}
 const input='w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700';
 return <form ref={form} action="/auth/login" method="post" onSubmit={submit} aria-busy={pending} className="space-y-5">
  <div className="space-y-2"><label htmlFor="login-email" className="block text-sm font-medium">Email</label><input id="login-email" name="email" type="email" autoComplete="username" required maxLength={254} className={input}/></div>
  <div className="space-y-2"><label htmlFor="login-password" className="block text-sm font-medium">Password</label><input id="login-password" name="password" type="password" autoComplete="current-password" required maxLength={256} className={input}/></div>
  <p ref={alert} role={message?'alert':undefined} tabIndex={-1} className="text-sm text-zinc-700 empty:hidden dark:text-zinc-300">{message}</p>
  <button type="submit" disabled={pending} className="w-full rounded-lg bg-zinc-900 px-4 py-3 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900">{pending?'Signing in…':'Sign in'}</button>
  <p role="status" className="text-sm empty:hidden">{pending?'Signing in. Please wait.':''}</p>
 </form>;
}
