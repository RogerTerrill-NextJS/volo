import type {Metadata} from 'next';
import Link from '../../_components/progress-link';
import Form from 'next/form';
import {redirect} from 'next/navigation';
import {Suspense} from 'react';
import {getPageAccess} from '../../../lib/auth/page-access';
import {normalizeDirectoryCriteria,type DirectoryCriteria} from '../../../lib/profiles/directory-search';
import {listDirectoryProfiles} from '../../../lib/profiles/directory-query';
import AppShell from '../_components/app-shell';
import AccessState from '../_components/access-state';
import PilotCard from './pilot-card';

export const metadata:Metadata={title:'Pilot directory | Volo',description:'Meet pilots in the Volo network.',robots:{index:false,follow:false}};
// HTML limits count UTF-16 units; allow room for 80 supplementary characters.
// The server independently enforces the 80-code-point limit for every criterion.
const inputMaxUnits=160;
const linkClass='inline-flex min-h-11 items-center rounded-lg px-4 py-2 font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4';

function DirectoryLoading(){
 return <div role="status" aria-live="polite" aria-busy="true" className="space-y-6">
  <p className="text-zinc-600">Loading pilots…</p>
  <div aria-hidden="true" className="grid gap-6 sm:grid-cols-2">
   {[0,1,2,3].map(key=><div key={key} className="h-64 rounded-2xl border border-zinc-200 bg-zinc-50"/>)}
  </div>
 </div>;
}

function directoryHref(criteria:DirectoryCriteria,after?:string){
 const params=new URLSearchParams();
 for(const field of ['search','certificate','rating','aircraft'] as const){
  if(criteria[field])params.set(field==='search'?'q':field,criteria[field]);
 }
 if(after)params.set('after',after);
 return `/directory${params.size?'?'+params.toString():''}`;
}

async function DirectoryListing({after,criteria}:{after:string|string[]|undefined;criteria:Record<string,string|string[]|undefined>}){
 const normalized=normalizeDirectoryCriteria(criteria)??{};
 const hasCriteria=Object.keys(normalized).length>0;
 const firstPage=directoryHref(normalized);
 const result=await listDirectoryProfiles({...criteria,...(after===undefined?{}:{after})});
 if(result.status!=='authorized'){
 if(result.status==='unauthenticated')redirect('/login?reason=authentication-required');
 if(result.status==='forbidden')return <section role="alert" className="space-y-4">
  <h2 className="text-xl font-semibold">Access denied</h2>
  <p>Your account does not currently have access to this workspace.</p>
 </section>;
 if(result.status==='invalid')return <section className="space-y-4" aria-labelledby="directory-state-heading">
  <h2 id="directory-state-heading" className="text-xl font-semibold">Invalid directory page</h2>
  <p className="text-zinc-600">Use a valid page link and at most 80 characters in each search or filter field.</p>
  <Link href={firstPage} prefetch={false} className={linkClass}>Back to first page</Link>
 </section>;
  const validCursor=typeof after==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(after);
  return <section role="alert" className="space-y-4" aria-labelledby="directory-state-heading">
   <h2 id="directory-state-heading" className="text-xl font-semibold">Directory temporarily unavailable</h2>
   <p className="text-zinc-600">We could not load the pilots. Please try again.</p>
   <a href={validCursor?directoryHref(normalized,after):firstPage} className={linkClass}>Try again</a>
  </section>;
 }
 return <section className="space-y-6" aria-label="Directory results">
  {result.rows.length===0?<div className="space-y-3 rounded-2xl border border-zinc-200 p-6 sm:p-8">
   <h2 className="text-xl font-semibold">{after?'No more pilots on this page':hasCriteria?'No pilots match your search':'No pilots to show yet'}</h2>
   <p className="text-zinc-600">{hasCriteria?'Try a different search or filters, or reset all criteria.':after?'The directory may have changed since this link was created. Return to the first page to browse again.':'Pilots will appear here when their profiles are ready.'}</p>
  </div>:<>
   <p className="text-sm text-zinc-600">{result.rows.length} {result.rows.length===1?'pilot':'pilots'} on this page</p>
   <ul aria-label="Pilots" className="grid gap-6 sm:grid-cols-2">
    {result.rows.map(pilot=><PilotCard key={pilot.user_id} pilot={pilot}/>)}
   </ul>
  </>}
  {(after||result.nextCursor)&&<nav aria-label="Directory pages" className="flex flex-wrap items-center justify-between gap-4">
   {after&&<Link href={firstPage} prefetch={false} className={linkClass}>Back to first page</Link>}
   {result.nextCursor&&<Link href={directoryHref(normalized,result.nextCursor)} prefetch={false} className={`${linkClass} ml-auto`}>Next page <span aria-hidden="true" className="ml-2">→</span></Link>}
  </nav>}
 </section>;
}

export default async function DirectoryPage({searchParams}:{searchParams:Promise<{[key:string]:string|string[]|undefined}>}){
 const access=await getPageAccess();
 if(access.status!=='authorized')return <AccessState status={access.status} retryHref="/directory"/>;
 const query=await searchParams;
 const criteria={search:query.q,certificate:query.certificate,rating:query.rating,aircraft:query.aircraft};
 const normalized=normalizeDirectoryCriteria(criteria)??{};
 const term=normalized.search??'';
 const hasFilters=Boolean(normalized.certificate||normalized.rating||normalized.aircraft);
 return <AppShell isAdmin={access.member.role==='admin'}>
  <header className="max-w-xl space-y-3">
   <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Pilot directory</h1>
   <p className="text-zinc-600">Meet pilots in the Volo network. Profile details are self-reported.</p>
  </header>
  <Form action="/directory" prefetch={false} className="space-y-5">
   <div className="space-y-3">
    <label htmlFor="directory-search" className="block text-sm font-medium">Name or home airport</label>
    <input key={term} id="directory-search" name="q" type="search" maxLength={inputMaxUnits} defaultValue={term} aria-describedby="directory-search-hint" className="min-h-11 w-full min-w-0 rounded-lg border border-zinc-400 bg-transparent px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-4"/>
    <p id="directory-search-hint" className="text-sm text-zinc-600">Search by part of a pilot’s name or home airport identifier.</p>
   </div>
   <fieldset className="grid min-w-0 gap-4 sm:grid-cols-3" aria-describedby="directory-filter-hint">
    <legend className="mb-3 text-sm font-semibold">Pilot filters</legend>
    {([['certificate','Certificate'],['rating','Rating'],['aircraft','Aircraft access']] as const).map(([field,label])=><div key={field} className="min-w-0 space-y-2">
     <label htmlFor={`directory-${field}`} className="block text-sm font-medium">{label}</label>
     <input key={normalized[field]??''} id={`directory-${field}`} name={field} type="text" maxLength={inputMaxUnits} defaultValue={normalized[field]??''} className="min-h-11 w-full min-w-0 rounded-lg border border-zinc-400 bg-transparent px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-4"/>
    </div>)}
   </fieldset>
   <p id="directory-filter-hint" className="text-sm text-zinc-600">Match part of a self-reported label or aircraft description. Pilots must match every populated field. Missing details do not match an active filter. Use up to 80 characters per field.</p>
   <div className="flex flex-wrap items-center gap-3">
    <button type="submit" className="min-h-11 rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-4">Search pilots</button>
    {term&&<Link href={directoryHref({...normalized,search:undefined})} prefetch={false} className={linkClass}>Clear search</Link>}
    {hasFilters&&<Link href="/directory" prefetch={false} className={linkClass}>Reset all</Link>}
   </div>
  </Form>
  <Suspense key={JSON.stringify([normalized,query.after])} fallback={<DirectoryLoading/>}><DirectoryListing after={query.after} criteria={criteria}/></Suspense>
 </AppShell>;
}
