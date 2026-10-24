import Link from 'next/link';
import {redirect} from 'next/navigation';
import {listIncomingRequests} from '../../../../../lib/flights/incoming-query';
import DecisionControls from './decision-controls';
const linkClass='inline-flex min-h-11 w-fit items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4';
export function IncomingLoading(){return <section aria-labelledby="incoming-heading" aria-busy="true" className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800"><h2 id="incoming-heading" className="text-xl font-semibold">Incoming requests</h2><p role="status">Loading incoming requests…</p></section>;}

export default async function IncomingRequests({flightId,after}:{flightId:string;after:unknown}){
 const result=await listIncomingRequests(flightId,after),first=`/dashboard/flights/${flightId}`;
 const href=(value:string)=>`${first}?requestsAfter=${encodeURIComponent(value)}#incoming-heading`;
 if(result.status==='unauthenticated')redirect('/login?reason=authentication-required');
 if(result.status!=='authorized')return <section className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800" aria-labelledby="incoming-heading" role="alert">
  <h2 id="incoming-heading" className="text-xl font-semibold">Incoming requests</h2>
  <p>{result.status==='invalid'?'This request page link is invalid.':result.status==='missing'||result.status==='forbidden'?'Incoming requests are not available for this account.':'Incoming requests are temporarily unavailable. Please try again.'}</p>
  <a href={result.status==='unavailable'&&typeof after==='string'?href(after):first+'#incoming-heading'} className={linkClass}>{result.status==='invalid'?'Back to first page':'Try again'}</a>
 </section>;
 return <section aria-labelledby="incoming-heading" className="space-y-5 border-t border-zinc-200 pt-6 dark:border-zinc-800">
  <h2 id="incoming-heading" className="text-xl font-semibold">Incoming requests</h2>
  <p className="text-sm text-zinc-600 dark:text-zinc-400">Pilots interested in your flight. Newest requests first.</p>
  {result.rows.length===0?<p>{after?'No more requests on this page.':'No requests yet. Interested pilots will appear here.'}</p>:<ul aria-label="Incoming pilot requests" className="space-y-4">
   {result.rows.map(request=><li key={request.id} id={`request-${request.id}`} className="min-w-0 space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
    <div className="flex flex-wrap items-start justify-between gap-3">
     <div className="min-w-0 space-y-1">{request.pilot?<><h3 className="text-lg font-semibold">{request.pilot.displayName}</h3><p>Home airport: {request.pilot.homeAirport}</p><Link href={`/directory/${request.pilot.userId}`} prefetch={false} className={linkClass}>View pilot profile</Link></>:<h3 className="font-semibold">Pilot profile unavailable</h3>}</div>
    </div>
    <p className="whitespace-pre-line [overflow-wrap:anywhere]">{request.note||'No introduction provided.'}</p>
    <p className="text-sm text-zinc-600 dark:text-zinc-400">First requested: <time dateTime={request.createdAt}>{request.createdAt.slice(0,10)} at {request.createdAt.slice(11,16)} UTC</time></p>
    <DecisionControls flightId={flightId} requestId={request.id} initialStatus={request.status} permalink={(typeof after==='string'?`${first}?requestsAfter=${encodeURIComponent(after)}`:first)+'#request-'+request.id} pilotName={request.pilot?.displayName??'this pilot'}/>
   </li>)}
  </ul>}
  {(after||result.nextCursor)&&<nav aria-label="Incoming request pages" className="flex flex-wrap justify-between gap-4">
   {Boolean(after)&&<Link href={first+'#incoming-heading'} prefetch={false} className={linkClass}>Back to first page</Link>}
   {result.nextCursor&&<Link href={href(result.nextCursor)} prefetch={false} className={`${linkClass} ml-auto`}>Next requests</Link>}
  </nav>}
 </section>;
}
