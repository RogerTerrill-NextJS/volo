'use client';
import {useActionState,useEffect,useRef,useState,type FormEvent} from 'react';
import {emptyFlightForm,type FlightFormState} from '../../../../../lib/flights/form-state';
import {validateFlightForCreation,type FlightField} from '../../../../../lib/flights/validation';

const inputClass='w-full min-w-0 rounded-lg border border-zinc-300 bg-transparent px-3 py-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700';
const permalink='/dashboard/flights/new';
type Feedback={fieldErrors:FlightFormState['fieldErrors'];message:string};

function VisibilityChoice({initial,error}:{initial?:string;error?:string}){
 const [visibility,setVisibility]=useState(initial??'');
 return <fieldset id="flight-visibility" tabIndex={-1} aria-invalid={error?true:undefined} aria-describedby={`flight-visibility-help${error?' flight-visibility-error':''}`} className="min-w-0 space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
  <legend className="px-1 text-sm font-medium">Who can see this flight? (required)</legend>
  <p id="flight-visibility-help" className="text-sm text-zinc-600 dark:text-zinc-400">Choose one audience before publishing.</p>
  <label className="flex min-h-11 items-start gap-3 py-2">
   <input type="radio" name="visibility" value="NETWORK" required defaultChecked={initial==='NETWORK'} onChange={()=>setVisibility('NETWORK')} aria-describedby="flight-network-help" className="mt-1 h-5 w-5 shrink-0"/>
   <span><span className="block font-medium">Network</span><span id="flight-network-help" className="text-sm text-zinc-600 dark:text-zinc-400">All active Volo members can see this flight.</span></span>
  </label>
  <label className="flex min-h-11 items-start gap-3 py-2">
   <input type="radio" name="visibility" value="PRIVATE" required defaultChecked={initial==='PRIVATE'} onChange={()=>setVisibility('PRIVATE')} aria-describedby="flight-private-help" className="mt-1 h-5 w-5 shrink-0"/>
   <span><span className="block font-medium">Private</span><span id="flight-private-help" className="text-sm text-zinc-600 dark:text-zinc-400">Only you can see this flight while no other pilots are selected.</span></span>
  </label>
  {visibility==='PRIVATE'&&<section aria-labelledby="flight-private-audience" className="space-y-1 rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
   <h2 id="flight-private-audience" className="font-medium">Private audience</h2>
   <p>No other pilots have been selected. Only you can see this flight.</p>
  </section>}
  {error&&<p id="flight-visibility-error" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
 </fieldset>;
}

export default function FlightForm({publish}:{publish:(previous:FlightFormState,form:FormData)=>Promise<FlightFormState>}){
 const [state,action,pending]=useActionState(publish,emptyFlightForm,permalink);
 const [local,setLocal]=useState<Feedback|null>(null);
 const feedback=useRef<HTMLDivElement>(null),submitting=useRef(false);
 const errors=local?.fieldErrors??state.fieldErrors,message=local?.message??state.message;
 const blocked=state.status!=='editing';
 useEffect(()=>{submitting.current=false;if(state.message)feedback.current?.focus();},[state]);
 useEffect(()=>{if(local)feedback.current?.focus();},[local]);
 function submit(event:FormEvent<HTMLFormElement>){
  if(pending||submitting.current||blocked){event.preventDefault();return;}
  const fields=new FormData(event.currentTarget);
  const raw=Object.fromEntries([...fields].filter(([key])=>!key.startsWith('$ACTION_')));
  const validated=validateFlightForCreation(raw);
  if(!validated.ok){event.preventDefault();setLocal(validated);return;}
  submitting.current=true;setLocal(null);
 }
 function description(field:FlightField){return `flight-${field}-help${errors[field]?` flight-${field}-error`:''}`;}
 function error(field:FlightField){return errors[field]&&<p id={`flight-${field}-error`} className="text-sm text-red-700 dark:text-red-400">{errors[field]}</p>;}
 function input(field:Exclude<FlightField,'departure_occurrence'|'visibility'|'notes'>,label:string,help:string,type='text'){
  return <div className="min-w-0 space-y-2">
   <label htmlFor={`flight-${field}`} className="block text-sm font-medium">{label} (required)</label>
   <input id={`flight-${field}`} name={field} type={type} required defaultValue={state.values[field]??''} autoComplete="off"
    autoCapitalize={field.endsWith('airport')?'characters':'off'} step={type==='time'?'1':type==='number'?'1':undefined} min={type==='number'?'1':undefined} max={type==='number'?'2147483647':undefined}
    inputMode={type==='number'?'numeric':undefined} list={field==='departure_timezone'?'flight-timezones':undefined}
    placeholder={field==='departure_timezone'?'America/Los_Angeles':field.endsWith('airport')?'KPAO':undefined}
    aria-invalid={errors[field]?true:undefined} aria-describedby={description(field)} className={inputClass}/>
   <p id={`flight-${field}-help`} className="text-sm text-zinc-600 dark:text-zinc-400">{help}</p>{error(field)}
  </div>;
 }
 return <div className="w-full max-w-xl min-w-0 space-y-6">
  <div ref={feedback} tabIndex={-1} role={message?(state.status==='created'&&!local?'status':'alert'):undefined} className="space-y-3 break-words empty:hidden">
   {message&&<p>{message}</p>}
   {Object.keys(errors).length>0&&<ul className="list-disc space-y-2 pl-5">{Object.entries(errors).map(([field,text])=><li key={field}><a href={`#flight-${field}`} className="underline underline-offset-4">{text}</a></li>)}</ul>}
   {state.status==='created'&&<><p className="text-sm">Flight reference: <span className="break-all">{state.flightId}</span></p><a href={permalink} className="inline-block py-3 underline underline-offset-4">Post another flight</a></>}
   {state.status==='denied'&&<a href="/onboarding" className="inline-block py-3 underline underline-offset-4">Complete your profile</a>}
  </div>
  {state.status!=='created'&&<form key={state.revision} action={action} onSubmit={submit} noValidate aria-busy={pending} className="space-y-6">
   <fieldset disabled={pending||blocked} className="min-w-0 space-y-6 disabled:opacity-70">
    <legend className="sr-only">Flight details</legend>
    <VisibilityChoice initial={state.values.visibility} error={errors.visibility}/>
    {input('departure_airport','Departure airport','Airport identifier, 2–8 letters or numbers.')}
    {input('destination_airport','Destination airport','Airport identifier. It can be the same as your departure airport.')}
    <div className="grid min-w-0 gap-6 sm:grid-cols-2">
     {input('departure_local_date','Departure date','The calendar date at the departure airport.','date')}
     {input('departure_local_time','Departure time','Local time at the departure airport.','time')}
    </div>
    {input('departure_timezone','Departure timezone','Enter a named timezone such as America/Los_Angeles, or UTC. Your device timezone is not used.')}
    <datalist id="flight-timezones">{['America/Los_Angeles','America/Denver','America/Chicago','America/New_York','Pacific/Honolulu','America/Anchorage','Europe/London','UTC'].map(zone=><option key={zone} value={zone}/>)}</datalist>
    <div className="space-y-2">
     <label htmlFor="flight-departure_occurrence" className="block text-sm font-medium">Repeated local time (only when required)</label>
     <select id="flight-departure_occurrence" name="departure_occurrence" defaultValue={state.values.departure_occurrence??''} aria-describedby={description('departure_occurrence')} aria-invalid={errors.departure_occurrence?true:undefined} className={inputClass}>
      <option value="">No occurrence selected</option><option value="earlier">Earlier occurrence</option><option value="later">Later occurrence</option>
     </select>
     <p id="flight-departure_occurrence-help" className="text-sm text-zinc-600 dark:text-zinc-400">When clocks move back, a local time can occur twice. If prompted, choose the earlier or later occurrence. Times skipped by a clock change cannot be posted.</p>{error('departure_occurrence')}
    </div>
    {input('aircraft_description','Aircraft','Describe the aircraft. Up to 500 characters.')}
    {input('pilot_places','Joining-pilot places','Number of available pilot places, excluding you. Enter a whole number greater than zero.','number')}
    <div className="space-y-2">
     <label htmlFor="flight-notes" className="block text-sm font-medium">Notes (optional)</label>
     <textarea id="flight-notes" name="notes" rows={5} defaultValue={state.values.notes??''} aria-invalid={errors.notes?true:undefined} aria-describedby={description('notes')} className={inputClass}/>
     <p id="flight-notes-help" className="text-sm text-zinc-600 dark:text-zinc-400">Anything else joining pilots should know. Up to 2,000 characters.</p>{error('notes')}
    </div>
    <button type="submit" disabled={pending||blocked} className="w-full rounded-lg bg-zinc-900 px-4 py-3 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900">{pending?'Publishing flight…':'Publish flight'}</button>
   </fieldset>
   <p role="status" className="text-sm empty:hidden">{pending?'Publishing your flight. Please wait.':''}</p>
  </form>}
 </div>;
}
