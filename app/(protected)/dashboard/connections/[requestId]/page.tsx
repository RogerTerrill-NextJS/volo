import type {Metadata} from 'next';
import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getPageAccess} from '../../../../../lib/auth/page-access';
import {getClosedConnection} from '../../../../../lib/flights/closed-connection-query';
import {getConnectionView} from '../../../../../lib/flights/connection-view-query';
import {formatFeedDeparture} from '../../../../../lib/flights/feed-view';
import AppShell from '../../../_components/app-shell';
import AccessState from '../../../_components/access-state';
import ProfilePhoto from '../../../_components/profile-photo';
import PilotDetails from '../../../_components/pilot-details';
export const metadata:Metadata={title:'Flight connection | Volo',robots:{index:false,follow:false}};
const linkClass='inline-flex min-h-11 w-fit items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4';
export default async function ConnectionPage({params}:{params:Promise<{requestId:string}>}){
 const access=await getPageAccess();if(access.status!=='authorized')return <AccessState status={access.status} retryHref="/dashboard/flights"/>;
 const {requestId}=await params,active=await getConnectionView(requestId);
 const result=active.status==='missing'?await getClosedConnection(requestId):active;
 if(result.status==='unauthenticated')redirect('/login?reason=authentication-required');
 if(result.status==='forbidden')return <AccessState status="forbidden"/>;
 if(result.status==='closed'){
  const {history,flight}=result,departure=flight?formatFeedDeparture(flight.departure_at,flight.departure_timezone):null;
  return <AppShell isAdmin={access.member.role==='admin'}>
   <Link href="/dashboard/flights" prefetch={false} className={linkClass}>Back to upcoming flights</Link>
   <header className="space-y-3"><h1 className="text-3xl font-semibold tracking-tight">{history.status==='withdrawn'?'Request withdrawn':'Request cancelled'}</h1>
    <p>{history.status==='withdrawn'?'The joining pilot withdrew this request.':flight?.status==='cancelled'?'The posting pilot cancelled this flight.':'This request has been cancelled.'}</p>
    <p>This request is closed. It does not provide an active connection or permission to send messages. Your permitted request history remains available here.</p>
   </header>
   <section aria-labelledby="closed-request-history" className="min-w-0 space-y-4 rounded-2xl border border-zinc-200 p-5 [overflow-wrap:anywhere] sm:p-8 dark:border-zinc-800">
    <h2 id="closed-request-history" className="text-2xl font-semibold">Request history</h2>
    <p>{history.isOwner?'You are the posting pilot.':'You are the joining pilot.'}</p>
    <h3 className="text-lg font-semibold">Introduction</h3><p className="whitespace-pre-line">{history.note||'No introduction provided.'}</p>
   </section>
   {flight?<section aria-labelledby="closed-flight" className="min-w-0 space-y-4 rounded-2xl border border-zinc-200 p-5 [overflow-wrap:anywhere] sm:p-8 dark:border-zinc-800">
    <h2 id="closed-flight" className="text-2xl font-semibold">{flight.departure_airport} → {flight.destination_airport}</h2>
    <p>{flight.status==='cancelled'?'Flight cancelled':flight.status==='completed'?'Flight completed':flight.isPast?'Past departure':'Flight open'}</p>
    {departure&&<p><time dateTime={flight.departure_at}>{departure.localDate} at {departure.localTime} · {departure.timeZone} ({departure.utcOffset})</time></p>}
    <p>{flight.aircraft_description}</p>
    <Link href={`/dashboard/flights/${flight.id}`} prefetch={false} className={linkClass}>{history.status==='withdrawn'&&!history.isOwner&&flight.status==='open'&&!flight.isPast?'View flight and resubmission eligibility':'View flight'}</Link>
    {history.status==='withdrawn'&&flight.status==='open'&&<p>A new request requires fresh acceptance from the posting pilot.</p>}
   </section>:<p>Flight details are no longer available to this account. Retained request history does not restore access to a private flight.</p>}
   <form action={`/dashboard/connections/${history.requestId}`} method="get"><button className={linkClass}>Check connection status</button></form>
  </AppShell>;
 }
 if(result.status!=='authorized')return <AppShell isAdmin={access.member.role==='admin'}>
  <section role={result.status==='unavailable'?'alert':undefined} className="space-y-4">
   <h1 className="text-3xl font-semibold tracking-tight">{result.status==='unavailable'?'Connection temporarily unavailable':'Connection unavailable'}</h1>
   <p>{result.status==='unavailable'?'We could not load this connection. Please try again.':'This accepted connection could not be found or is no longer available to this account.'}</p>
   <form action={`/dashboard/connections/${encodeURIComponent(requestId)}`} method="get"><button className={linkClass}>Check connection status</button></form>
  </section><Link href="/dashboard/flights" prefetch={false} className={linkClass}>Back to upcoming flights</Link>
 </AppShell>;
 const {connection,flight,pilot}=result,departure=formatFeedDeparture(flight.departure_at,flight.departure_timezone);
 return <AppShell isAdmin={access.member.role==='admin'}>
  <Link href={`/dashboard/flights/${flight.id}`} prefetch={false} className={linkClass}>Back to flight</Link>
  <header className="space-y-3"><h1 className="text-3xl font-semibold tracking-tight">Accepted connection</h1><p>{connection.isOwner?'You are the posting pilot. This pilot has been accepted for your flight.':'Your request has been accepted by the posting pilot.'}</p></header>
  <section aria-labelledby="connection-flight" className="min-w-0 space-y-6 rounded-2xl border border-zinc-200 p-5 [overflow-wrap:anywhere] sm:p-8 dark:border-zinc-800">
   <p>{flight.visibility==='PRIVATE'?'Private':'Network'} · {flight.isPast?'Past departure':'Open'}</p>
   <h2 id="connection-flight" className="text-2xl font-semibold">{flight.departure_airport} → {flight.destination_airport}</h2>
   {flight.isPast&&<p>The scheduled departure time has passed.</p>}
   <dl className="grid gap-6 sm:grid-cols-2"><div><dt>Departure local time</dt><dd>{departure?<time dateTime={flight.departure_at}>{departure.localDate} at {departure.localTime}<span className="block">{departure.timeZone} ({departure.utcOffset})</span></time>:'Departure time unavailable'}</dd></div><div><dt>Aircraft</dt><dd>{flight.aircraft_description}</dd></div><div><dt>Joining-pilot capacity</dt><dd>{flight.pilot_places} {flight.pilot_places===1?'place':'places'}, excluding the posting pilot</dd></div></dl>
   <div className="space-y-2"><h3 className="text-lg font-semibold">Flight notes</h3><p className="whitespace-pre-line">{flight.notes||'No notes provided.'}</p></div>
  </section>
  <section aria-labelledby="connected-pilot" className="min-w-0 space-y-6 rounded-2xl border border-zinc-200 p-5 [overflow-wrap:anywhere] sm:p-8 dark:border-zinc-800">
   <h2 id="connected-pilot" className="text-2xl font-semibold">{connection.isOwner?'Joining pilot':'Posting pilot'}</h2>
   {pilot?<><div className="flex flex-wrap items-center gap-4"><ProfilePhoto userId={pilot.user_id} displayName={pilot.display_name} available={pilot.photoAvailable}/><div className="min-w-0"><h3 className="text-xl font-semibold">{pilot.display_name}</h3><Link href={`/directory/${pilot.user_id}`} prefetch={false} className={linkClass}>View pilot profile</Link></div></div><p className="text-sm">Profile details are self-reported.</p><PilotDetails pilot={pilot} className="grid gap-6 sm:grid-cols-2"/></>:<p>Pilot profile temporarily unavailable. The accepted flight connection is still available.</p>}
  </section>
 </AppShell>;
}
