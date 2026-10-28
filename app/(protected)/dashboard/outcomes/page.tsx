import type {Metadata} from 'next';
import Link from '../../../_components/progress-link';
import {redirect} from 'next/navigation';
import {getPageAccess} from '../../../../lib/auth/page-access';
import {listFlightOutcomes} from '../../../../lib/outcomes/query';
import {formatFeedDeparture} from '../../../../lib/flights/feed-view';
import AppShell from '../../_components/app-shell';
import AccessState from '../../_components/access-state';
import OutcomeForm from './outcome-form';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Flight outcomes | Volo',robots:{index:false,follow:false}};
const linkClass='inline-flex min-h-11 w-fit items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4';
export default async function FlightOutcomesPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const access=await getPageAccess();if(access.status!=='authorized')return <AccessState status={access.status} retryHref="/dashboard/outcomes"/>;
 const {after}=await searchParams,result=await listFlightOutcomes(after);
 if(result.status==='unauthenticated')redirect('/login?reason=authentication-required');if(result.status==='forbidden')return <AccessState status="forbidden"/>;
 const permalink=result.status==='authorized'&&typeof after==='string'?`/dashboard/outcomes?after=${after}`:'/dashboard/outcomes';
 return <AppShell isAdmin={access.member.role==='admin'}>
  <Link href="/dashboard" prefetch={false} className={linkClass}>Back to dashboard</Link>
  <header className="space-y-3"><h1 className="text-3xl font-semibold">Flight outcomes</h1><p>Optional feedback about your accepted connections, available after the scheduled date in the flight’s timezone. You can leave a question unanswered or correct your answer later while the connection remains eligible.</p><p>Only your own answer is shown here. The other pilot cannot see it. Founders see aggregate counts; a response does not verify flight completion or change requests, messages or flight status.</p></header>
  {result.status==='authorized'?<>
   {result.rows.length===0?<p>{after?'No more flight outcomes on this page.':'No flight outcomes are available yet. Eligible accepted connections appear here after their flight date.'}</p>:<ul className="space-y-6" aria-label="Past accepted connections">{result.rows.map(outcome=>{const departure=formatFeedDeparture(outcome.departureAt,outcome.departureTimezone);return <li id={'outcome-'+outcome.requestId} key={outcome.requestId} className="min-w-0 space-y-4 rounded-2xl border border-zinc-200 p-5 [overflow-wrap:anywhere]">
    <h2 className="text-xl font-semibold">{outcome.departureAirport} → {outcome.destinationAirport}</h2>
    <p>{outcome.isOwner?'Joining pilot':'Posting pilot'}: {outcome.counterpartName??'Profile unavailable'}</p>
    {departure&&<p><time dateTime={outcome.departureAt}>{departure.localDate} · {departure.localTime} · {departure.timeZone}</time></p>}
    <p className="text-sm">Connection reference: {outcome.requestId}</p>
    <p>Your saved answer: {outcome.answer===null?'Not answered':outcome.answer?'Yes':'No'}</p>
    <OutcomeForm key={`${outcome.requestId}:${outcome.revision}`} outcome={outcome} permalink={permalink}/>
   </li>;})}</ul>}
   {(after||result.nextCursor)&&<nav aria-label="Flight outcome pages" className="flex flex-wrap gap-6">{Boolean(after)&&<Link href="/dashboard/outcomes" prefetch={false} className={linkClass}>Back to first page</Link>}{result.nextCursor&&<Link href={`/dashboard/outcomes?after=${result.nextCursor}`} prefetch={false} className={linkClass}>Next outcomes</Link>}</nav>}
  </>:<section role="alert" className="space-y-3"><h2 className="text-xl font-semibold">{result.status==='invalid'?'Invalid outcome page':'Flight outcomes temporarily unavailable'}</h2><p>{result.status==='invalid'?'Open the first page to continue.':'We could not load your flight outcomes. Please try again.'}</p><Link href="/dashboard/outcomes" prefetch={false} className={linkClass}>{result.status==='invalid'?'Back to first page':'Reload outcomes'}</Link></section>}
 </AppShell>;
}
