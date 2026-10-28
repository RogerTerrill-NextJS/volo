import type {ReactNode} from 'react';
import Link from '../../../../_components/progress-link';
import {reportHref} from '../../../../../lib/reports/links';
import type {DetailFlight} from '../../../../../lib/flights/detail-query';
import type {DirectoryProfile} from '../../../../../lib/profiles/directory-query';
import {formatFeedDeparture} from '../../../../../lib/flights/feed-view';
import ProfilePhoto from '../../../_components/profile-photo';
const linkClass='inline-flex min-h-11 w-fit items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4';

/** The page supplies independently authorized owner and joining-pilot controls. */
export default function FlightDetails({flight,pilot,ownerActions,joinerActions}:{flight:DetailFlight;pilot:DirectoryProfile|null;ownerActions?:ReactNode;joinerActions?:ReactNode}){
 const departure=formatFeedDeparture(flight.departure_at,flight.departure_timezone);
 const status=flight.status==='open'&&flight.isPast?'Past departure':{open:'Open',cancelled:'Cancelled',completed:'Completed'}[flight.status];
 const notice=flight.status==='cancelled'?{heading:'Cancelled flight',message:'This flight has been cancelled and is not listed in upcoming flights.'}
  :flight.status==='completed'?{heading:'Completed flight',message:'This flight is marked as completed and is not listed in upcoming flights.'}
  :flight.isPast?{heading:'Past departure',message:'The scheduled departure time has passed. This flight is no longer upcoming.'}:null;
 return <article aria-labelledby="flight-route" className="min-w-0 space-y-8 rounded-2xl border border-zinc-200 bg-white p-5 [overflow-wrap:anywhere] sm:p-8">
  <header className="space-y-3">
   <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{flight.visibility==='PRIVATE'?'Private':'Network'} · {status}</p>{flight.isOwn&&<span className="w-fit rounded-full border border-zinc-400 px-3 py-1 text-sm font-semibold">Your flight</span>}</div>
   <h1 id="flight-route" className="text-3xl font-semibold tracking-tight"><span className="sr-only">From </span>{flight.departure_airport}<span aria-hidden="true"> → </span><span className="sr-only"> to </span>{flight.destination_airport}</h1>
  </header>
  {notice&&<section aria-labelledby="flight-lifecycle" className="space-y-2 rounded-xl border border-zinc-300 bg-zinc-50 p-4">
   <h2 id="flight-lifecycle" className="text-lg font-semibold">{notice.heading}</h2>
   <p>{notice.message}</p>
  </section>}
  <dl className="grid gap-6 sm:grid-cols-2">
   <div><dt className="text-sm text-zinc-600">Departure local time</dt><dd className="mt-1 font-medium">{departure?<time dateTime={flight.departure_at}>{departure.localDate} at {departure.localTime}<span className="mt-1 block text-sm font-normal">{departure.timeZone} ({departure.utcOffset})</span></time>:'Departure time unavailable'}</dd></div>
   <div><dt className="text-sm text-zinc-600">Aircraft</dt><dd className="mt-1">{flight.aircraft_description}</dd></div>
   <div><dt className="text-sm text-zinc-600">Joining-pilot capacity</dt><dd className="mt-1">{flight.pilot_places} {flight.pilot_places===1?'place':'places'}, excluding the posting pilot</dd></div>
  </dl>
  <section aria-labelledby="flight-notes" className="space-y-2">
   <h2 id="flight-notes" className="text-xl font-semibold">Notes</h2>
   <p className="whitespace-pre-line">{flight.notes||'No notes provided.'}</p>
  </section>
  {ownerActions}
  <section aria-labelledby="posting-pilot" className="space-y-4 border-t border-zinc-200 pt-6">
   <h2 id="posting-pilot" className="text-xl font-semibold">Posting pilot</h2>
   {pilot?<div className="flex flex-wrap items-center gap-4">
    <ProfilePhoto userId={pilot.user_id} displayName={pilot.display_name} available={pilot.photoAvailable}/>
    <div className="min-w-0 space-y-1"><p className="text-lg font-medium">{pilot.display_name}</p><p>Home airport: {pilot.home_airport}</p><Link href={`/directory/${pilot.user_id}`} prefetch={false} className={linkClass}>View pilot profile</Link></div>
   </div>:<p className="text-zinc-600">Posting pilot information unavailable.</p>}
  </section>
  {joinerActions}
  <Link href={reportHref('flight',flight.id)??'/reports'} prefetch={false} className={linkClass}>Report this flight</Link>
 </article>;
}
