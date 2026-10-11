'use client';
import {useActionState,useEffect,useRef,useState,type FormEvent} from 'react';
import {completeProfile,type OnboardingState} from './actions';
import {validateProfile,type ProfileFieldErrors} from '../../../lib/profiles/validation';

const initial:OnboardingState={revision:0,values:{},fieldErrors:{},message:null,reload:false};
const inputClass='w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700';

export default function ProfileForm({unavailable=false}:{unavailable?:boolean}){
 const [state,action,pending]=useActionState(completeProfile,initial,'/onboarding');
 const [local,setLocal]=useState<{fieldErrors:ProfileFieldErrors;message:string}|null>(null);
 const feedback=useRef<HTMLDivElement>(null),submitting=useRef(false);
 const errors=local?.fieldErrors??state.fieldErrors,message=local?.message??state.message;
 useEffect(()=>{submitting.current=false;if(state.message)feedback.current?.focus();},[state]);
 useEffect(()=>{if(local)feedback.current?.focus();},[local]);
 function submit(event:FormEvent<HTMLFormElement>){
  if(pending||submitting.current||state.reload){event.preventDefault();return;}
  const fields=new FormData(event.currentTarget);
  // Action metadata belongs to React, not to the shared profile validator.
  const raw=Object.fromEntries([...fields].filter(([key])=>!key.startsWith('$ACTION_')));
  const validated=validateProfile(raw);
  if(!validated.ok){event.preventDefault();setLocal(validated);return;}
  submitting.current=true;setLocal(null);
 }
 function text(field:'display_name'|'home_airport'|'certificates'|'ratings'|'aircraft_access'|'flying_interests'|'bio',label:string,help:string,rows?:number){
  const id=`profile-${field}`,description=`${id}-help${errors[field]?` ${id}-error`:''}`;
  return <div className="space-y-2">
   <label htmlFor={id} className="block text-sm font-medium">{label}</label>
   {rows?<textarea id={id} name={field} rows={rows} defaultValue={state.values[field]??''} aria-invalid={errors[field]?true:undefined} aria-describedby={description} className={inputClass}/>
    :<input id={id} name={field} required autoComplete={field==='display_name'?'nickname':'off'} autoCapitalize={field==='home_airport'?'characters':'words'} defaultValue={state.values[field]??''} aria-invalid={errors[field]?true:undefined} aria-describedby={description} className={inputClass}/>}
   <p id={`${id}-help`} className="text-sm text-zinc-600 dark:text-zinc-400">{help}</p>
   {errors[field]&&<p id={`${id}-error`} className="text-sm text-red-700 dark:text-red-400">{errors[field]}</p>}
  </div>;
 }
 // A fresh failed read offers retry only. A failed native POST must still render
 // its action state so the pilot can read feedback and recover entered values.
 if(unavailable&&!state.message)return null;
 return <form key={state.revision} action={action} onSubmit={submit} noValidate aria-busy={pending} className="max-w-xl space-y-6">
  <div ref={feedback} tabIndex={-1} role={message?'alert':undefined} className="space-y-2 empty:hidden">
   {message&&<><p>{message}</p>{Object.keys(errors).length>0&&<ul className="list-disc pl-5">{Object.entries(errors).map(([field,error])=><li key={field}><a href={`#profile-${field}`} className="underline underline-offset-4">{error}</a></li>)}</ul>}</>}
   {state.reload&&<a href="/onboarding" className="underline underline-offset-4">Reload your profile</a>}
  </div>
  {text('display_name','Display name (required)','1–80 characters. This is the name other pilots will see.')}
  {text('home_airport','Home airport (required)','Use an airport identifier, such as KPAO. 2–8 letters or numbers.')}
  <fieldset id="profile-pilot_designation" tabIndex={-1} aria-describedby={errors.pilot_designation?'profile-pilot_designation-error':undefined} aria-invalid={errors.pilot_designation?true:undefined} className="space-y-3">
   <legend className="text-sm font-medium">Pilot designation (required)</legend>
   {(['student','licensed'] as const).map(value=><label key={value} className="flex min-h-11 items-center gap-3"><input type="radio" name="pilot_designation" value={value} required defaultChecked={state.values.pilot_designation===value} className="h-5 w-5"/>{value==='student'?'Student pilot':'Licensed pilot'}</label>)}
   {errors.pilot_designation&&<p id="profile-pilot_designation-error" className="text-sm text-red-700 dark:text-red-400">{errors.pilot_designation}</p>}
  </fieldset>
  <h2 className="text-xl font-semibold">More about your flying (optional)</h2>
  {text('certificates','Certificates','Self-reported. Enter one per line; up to 20, each 1–80 characters.',3)}
  {text('ratings','Ratings','Self-reported. Enter one per line; up to 20, each 1–80 characters.',3)}
  {text('aircraft_access','Aircraft access','Tell other pilots what aircraft you can access. Up to 500 characters.',3)}
  {text('flying_interests','Flying interests','What kind of flying interests you? Up to 500 characters.',3)}
  {text('bio','Bio','Introduce yourself. Up to 2,000 characters.',5)}
  <button disabled={pending||state.reload} type="submit" className="w-full rounded-lg bg-zinc-900 px-4 py-3 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900">{pending?'Saving profile…':'Save profile and continue'}</button>
  <p role="status" className="text-sm empty:hidden">{pending?'Saving your profile. Please wait.':''}</p>
 </form>;
}
