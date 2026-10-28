import type {Metadata} from 'next';
import Link from '../../../_components/progress-link';
import {redirect} from 'next/navigation';
import {getPageAccess} from '../../../../lib/auth/page-access';
import {listAdminFlights} from '../../../../lib/flights/moderation-query';
import {memberAdminUuid} from '../../../../lib/auth/member-admin-validation';
import {formatFeedDeparture} from '../../../../lib/flights/feed-view';
import AppShell from '../../_components/app-shell';
import AccessState from '../../_components/access-state';
import ModerationControl from './control';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Flight moderation | Volo',robots:{index:false,follow:false}};
const linkClass='inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4';
const date=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'long',timeZone:'UTC'});
export default async function FlightModerationPage({searchParams}:{searchParams:Promise<{after?:string|string[]}>}){
 const access=await getPageAccess();if(access.status!=='authorized')return <AccessState status={access.status} retryHref="/admin/flights"/>;
 if(access.member.role!=='admin')return <AccessState status="forbidden"/>;
 const {after}=await searchParams,result=await listAdminFlights(after);
 if(result.status==='unauthenticated')redirect('/login?reason=authentication-required');
 if(result.status==='forbidden')return <AccessState status="forbidden"/>;
 if(result.status!=='authorized')return <AppShell isAdmin><section role={result.status==='unavailable'?'alert':undefined} className="space-y-4"><h1 className="text-3xl font-semibold">{result.status==='invalid'?'This flight page is unavailable':'Flight moderation temporarily unavailable'}</h1><p>{result.status==='invalid'?'Open the first flight page to continue.':'We could not load flight status. No hide controls are available. Please try again.'}</p><form action="/admin/flights" method="get">{result.status==='unavailable'&&typeof after==='string'&&memberAdminUuid.test(after)&&<input type="hidden" name="after" value={after}/>}<button className={linkClass}>Check flight status</button></form></section></AppShell>;
 return <AppShell isAdmin>
  <header className="space-y-3"><h1 className="text-3xl font-semibold tracking-tight">Flight moderation</h1><p>Review posts and hide inappropriate or invalid flights. Hiding closes active requests and further message sends while retaining post and conversation history.</p><p className="text-sm">This administrator view includes private posts. It does not provide access to private conversations. Up to 50 posts per page, ordered by flight ID. Hidden posts cannot be restored here.</p></header>
  <section aria-label="Flight moderation list" className="space-y-6">
   {!result.rows.length&&<p>{after?'No more flights.':'No flights to moderate.'}</p>}
   {result.rows.map(row=>{const departure=formatFeedDeparture(row.departure_at,row.departure_timezone);return <article key={row.id} id={'flight-'+row.id} tabIndex={-1} aria-labelledby={'route-'+row.id} className="min-w-0 space-y-4 rounded-2xl border border-zinc-200 p-5 [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-4 sm:p-8">
    <h2 id={'route-'+row.id} className="text-xl font-semibold">{row.departure_airport} → {row.destination_airport}</h2>
    <p className="font-medium">{row.moderated_at?'Hidden':'Visible to eligible members'} · {row.visibility==='PRIVATE'?'Private':'Network'} · {row.status==='open'?'Open':row.status==='cancelled'?'Cancelled':'Completed'}</p>
    <dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt className="font-medium">Flight ID</dt><dd>{row.id}</dd></div><div><dt className="font-medium">Posting pilot ID</dt><dd>{row.owner_id}</dd></div><div><dt className="font-medium">Departure local time</dt><dd>{departure?<time dateTime={row.departure_at}>{departure.localDate} at {departure.localTime} · {departure.timeZone} ({departure.utcOffset})</time>:'Departure time unavailable'}</dd></div><div><dt className="font-medium">Aircraft</dt><dd>{row.aircraft_description}</dd></div><div><dt className="font-medium">Joining-pilot capacity</dt><dd>{row.pilot_places} {row.pilot_places===1?'place':'places'}, excluding the posting pilot</dd></div><div><dt className="font-medium">Posted</dt><dd><time dateTime={row.created_at}>{date.format(new Date(row.created_at))}</time></dd></div></dl>
    <div className="space-y-2"><h3 className="font-medium">Post notes</h3><p className="whitespace-pre-line">{row.notes||'No notes provided.'}</p></div>
    {row.moderated_at&&<div className="space-y-2"><h3 className="font-medium">Moderation record</h3><p>Hidden <time dateTime={row.moderated_at}>{date.format(new Date(row.moderated_at))}</time></p><p className="whitespace-pre-line">{row.moderation_reason}</p></div>}
    <ModerationControl flightId={row.id} hidden={row.moderated_at!==null} after={typeof after==='string'?after:undefined}/>
   </article>;})}
  </section>
  <nav aria-label="Moderation pages" className="flex flex-wrap gap-6">{after&&<Link href="/admin/flights" prefetch={false} className={linkClass}>First flight page</Link>}{result.nextCursor&&<Link href={'/admin/flights?after='+result.nextCursor} prefetch={false} className={linkClass}>Next flights</Link>}</nav>
 </AppShell>;
}
