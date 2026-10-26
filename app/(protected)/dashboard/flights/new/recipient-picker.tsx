'use client';
import {useCallback,useEffect,useRef,useState,useTransition} from 'react';
import {findRecipientCandidates} from './actions';
import type {Candidate} from '../../../../../lib/flights/recipient-query';

export type SelectedPilot=Pick<Candidate,'user_id'|'display_name'|'home_airport'>;
type Page=Awaited<ReturnType<typeof findRecipientCandidates>>;
const control='min-h-11 rounded-lg border border-zinc-300 px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60';
export default function RecipientPicker({selected,onChange,error}:{selected:SelectedPilot[];onChange:(pilots:SelectedPilot[])=>void;error?:string}){
 const [search,setSearch]=useState('');
 const [page,setPage]=useState<Page|null>(null);
 const [query,setQuery]=useState('');
 const [pending,startTransition]=useTransition();
 const generation=useRef({value:0}),heading=useRef<HTMLHeadingElement>(null);
 const load=useCallback((term:string,after?:string)=>{
  const request=++generation.current.value;
  startTransition(async()=>{
   let result:Page;
   try{result=await findRecipientCandidates({search:term,...(after?{after}:{}),pageSize:20});}
   catch{result={status:'unavailable'};}
   if(request!==generation.current.value)return;
   setPage(result);setQuery(term);
   if(after)heading.current?.focus();
  });
 },[]);
 useEffect(()=>{const current=generation.current;load('');return()=>{current.value++;};},[load]);
 function toggle(pilot:SelectedPilot){onChange(selected.some(row=>row.user_id===pilot.user_id)?selected.filter(row=>row.user_id!==pilot.user_id):[...selected,pilot]);}
 return <section role="group" id="flight-recipient_ids" tabIndex={-1} aria-labelledby="flight-recipient-heading" aria-describedby={error?'flight-recipient-error':undefined} className="min-w-0 space-y-4 rounded-xl border border-zinc-200 p-4">
  <h2 id="flight-recipient-heading" className="font-medium">Select private recipients (required)</h2>
  <p className="text-sm">Only you and the pilots you select can see this flight. Select at least one pilot.</p>
  <noscript><p>Enable JavaScript to search and select private recipients before publishing.</p></noscript>
  <input type="hidden" name="recipient_ids" value={JSON.stringify(selected.map(row=>row.user_id))}/>
  <div className="space-y-2">
   <label htmlFor="flight-recipient-search" className="block text-sm font-medium">Search pilots by name or home airport</label>
   <input id="flight-recipient-search" type="search" value={search} maxLength={160} onChange={event=>setSearch(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();if(!pending)load(search);}}} className={`${control} w-full min-w-0 bg-transparent`} aria-describedby="flight-recipient-search-help"/>
   <p id="flight-recipient-search-help" className="text-sm text-zinc-600">Up to 80 characters. Your selected pilots stay selected across searches and pages.</p>
   <button type="button" disabled={pending} onClick={()=>load(search)} className={control}>Search pilots</button>
  </div>
  <div aria-busy={pending} className="space-y-3">
   <h3 ref={heading} tabIndex={-1} className="text-sm font-medium">Available pilots</h3>
   <p role="status" className="text-sm">{pending?'Loading pilots…':page?.status==='authorized'?`${page.rows.length} pilots on this page.`:page?.status==='invalid'?'Use a name or airport search of up to 80 characters.':page?.status==='unauthenticated'||page?.status==='forbidden'?'Your access could not be verified. Return to the dashboard before continuing.':page?.status==='unavailable'?'Pilots could not be loaded. Try searching again.':''}</p>
   {page?.status==='authorized'&&<>
    {page.rows.length===0&&<p className="text-sm">{page.nextCursor?'No selectable pilots on this page. Continue to the next page.':query?'No pilots match this search. Try another name or airport.':'No pilots are available to select right now.'}</p>}
    <ul className="space-y-1">{page.rows.map(pilot=><li key={pilot.user_id}><label className="flex min-h-11 items-start gap-3 py-2">
     <input type="checkbox" checked={selected.some(row=>row.user_id===pilot.user_id)} disabled={pending} onChange={()=>toggle(pilot)} className="mt-1 h-5 w-5 shrink-0"/>
     <span className="min-w-0 break-words"><span className="block font-medium">{pilot.display_name}</span><span className="text-sm text-zinc-600">{pilot.home_airport||'Home airport not listed'}</span></span>
    </label></li>)}</ul>
    {page.nextCursor&&<button type="button" disabled={pending} onClick={()=>load(query,page.nextCursor!)} className={control}>Next pilots</button>}
   </>}
  </div>
  <section aria-labelledby="flight-selected-heading" className="space-y-2 border-t border-zinc-200 pt-3">
   <h3 id="flight-selected-heading" className="text-sm font-medium">Selected pilots ({selected.length})</h3>
   {selected.length===0?<p className="text-sm">No pilots selected.</p>:<ul className="space-y-2">{selected.map(pilot=><li key={pilot.user_id} className="flex flex-wrap items-center justify-between gap-2">
    <span className="min-w-0 break-all">{pilot.display_name}{pilot.home_airport?` · ${pilot.home_airport}`:''}</span>
    <button type="button" onClick={()=>{toggle(pilot);document.getElementById('flight-recipient-search')?.focus();}} aria-label={`Remove ${pilot.display_name}`} className={control}>Remove</button>
   </li>)}</ul>}
  </section>
  {error&&<p id="flight-recipient-error" className="text-sm text-red-700">{error}</p>}
 </section>;
}
