import type {Metadata} from 'next';
import Link from 'next/link';
import Form from 'next/form';
import {redirect} from 'next/navigation';
import {Suspense} from 'react';
import {getPageAccess} from '../../../../lib/auth/page-access';
import {listUpcomingFlights} from '../../../../lib/flights/feed-query';
import {readFlightFeedSearch,flightFeedHref} from '../../../../lib/flights/feed-view';
import AppShell from '../../_components/app-shell';
import AccessState from '../../_components/access-state';
import FlightCard from './flight-card';

export const metadata:Metadata={title:'Upcoming flights | Volo',robots:{index:false,follow:false}};
const linkClass='inline-flex min-h-11 items-center rounded-lg px-3 py-2 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4';
const inputClass='min-h-11 w-full min-w-0 rounded-lg border border-zinc-400 bg-transparent px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-4';
function FeedLoading(){return <div role="status" aria-live="polite" aria-busy="true" className="space-y-4"><p>Loading upcoming flights…</p><div aria-hidden="true" className="grid gap-6 sm:grid-cols-2">{[0,1].map(key=><div key={key} className="h-64 rounded-2xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"/>)}</div></div>;}
async function FlightListing({search}:{search:ReturnType<typeof readFlightFeedSearch>}){
 const result=await listUpcomingFlights(search.input);
 const firstPage=flightFeedHref(search.criteria??{}),after=search.input.after;
 if(result.status!=='authorized'){
 if(result.status==='unauthenticated')redirect('/login?reason=authentication-required');
 if(result.status==='forbidden')return <section role="alert" className="space-y-3"><h2 className="text-xl font-semibold">Access denied</h2><p>Your account does not currently have access to this workspace.</p></section>;
 if(result.status==='invalid')return <section aria-labelledby="flight-state-heading" className="space-y-3">
  <h2 id="flight-state-heading" className="text-xl font-semibold">Check your flight filters or page link</h2>
  <p>Use airport identifiers of 2–8 letters or numbers and a valid date range with the start on or before the end. Each filter can have one value.</p>
  <Link href={firstPage} prefetch={false} className={linkClass}>Back to first page</Link>
 </section>;
 return <section role="alert" aria-labelledby="flight-state-heading" className="space-y-3">
  <h2 id="flight-state-heading" className="text-xl font-semibold">Flights temporarily unavailable</h2>
  <p>We could not load the flights. Please try again.</p>
  <a href={flightFeedHref(search.criteria??{},typeof after==='string'&&after.length<=2048?after:undefined)} className={linkClass}>Try again</a>
 </section>;
 }
 const filtered=Object.keys(search.criteria??{}).length>0;
 return <section aria-label="Upcoming flight results" className="space-y-6">
  {result.rows.length===0?<div className="space-y-3 rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
   <h2 className="text-xl font-semibold">{after?'No more flights on this page':filtered?'No flights match these filters':'No upcoming flights yet'}</h2>
   <p className="text-zinc-600 dark:text-zinc-400">{after?'Flights may have changed since this link was created. Return to the first page to browse again.':filtered?'Try different airports or dates, or clear the filters.':'Upcoming flights you can see will appear here when they are posted.'}</p>
  </div>:<>
   <p className="text-sm text-zinc-600 dark:text-zinc-400">{result.rows.length} {result.rows.length===1?'flight':'flights'} on this page, earliest departures first</p>
   <ul aria-label="Upcoming flights" className="grid gap-6 sm:grid-cols-2">{result.rows.map(flight=><FlightCard key={flight.id} flight={flight}/>)}</ul>
  </>}
  {(after||result.nextCursor)&&<nav aria-label="Flight pages" className="flex flex-wrap items-center justify-between gap-3">
   {after&&<Link href={firstPage} prefetch={false} className={linkClass}>Back to first page</Link>}
   {result.nextCursor&&<Link href={flightFeedHref(search.criteria??{},result.nextCursor)} prefetch={false} className={`${linkClass} ml-auto`}>Next page <span aria-hidden="true" className="ml-2">→</span></Link>}
  </nav>}
 </section>;
}
export default async function FlightsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const access=await getPageAccess();
 if(access.status!=='authorized')return <AccessState status={access.status} retryHref="/dashboard/flights"/>;
 const search=readFlightFeedSearch(await searchParams);
 return <AppShell isAdmin={access.member.role==='admin'}>
  <header className="max-w-xl space-y-3">
   <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Upcoming flights</h1>
   <p className="text-zinc-600 dark:text-zinc-400">Browse network flights and private flights shared with you. Departure times use each flight’s local timezone.</p>
   <Link href="/dashboard/flights/new" prefetch={false} className={linkClass}>Post a flight</Link>
  </header>
  <Form action="/dashboard/flights" prefetch={false} className="space-y-4">
   <fieldset className="grid min-w-0 gap-4 sm:grid-cols-2" aria-describedby="flight-filter-help">
    <legend className="mb-3 text-lg font-semibold">Filter flights</legend>
    {([['departureAirport','Departure airport'],['destinationAirport','Destination airport'],['dateFrom','Departure date from'],['dateTo','Departure date through']] as const).map(([field,label])=><div key={field} className="min-w-0 space-y-2">
     <label htmlFor={`feed-${field}`} className="block text-sm font-medium">{label}</label>
     <input key={JSON.stringify([search.input,field])} id={`feed-${field}`} name={field} type={field.endsWith('Airport')?'text':'date'} maxLength={field.endsWith('Airport')?32:undefined} autoCapitalize={field.endsWith('Airport')?'characters':undefined} autoComplete="off" defaultValue={search.values[field]} className={inputClass}/>
    </div>)}
   </fieldset>
   <p id="flight-filter-help" className="text-sm text-zinc-600 dark:text-zinc-400">Match exact airport identifiers and every populated filter. Dates include both endpoints in each flight’s departure timezone.</p>
   <div className="flex flex-wrap gap-3">
    <button type="submit" className="min-h-11 rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-4 dark:bg-zinc-100 dark:text-zinc-900">Apply filters</button>
    {/* A document navigation also clears unapplied drafts on the already-unfiltered URL. */}
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
    <a href="/dashboard/flights" className={linkClass}>Clear filters</a>
   </div>
  </Form>
  <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">Cards show the posted joining-pilot capacity. Remaining availability is not shown yet.</p>
  <Suspense key={JSON.stringify(search.input)} fallback={<FeedLoading/>}><FlightListing search={search}/></Suspense>
 </AppShell>;
}
