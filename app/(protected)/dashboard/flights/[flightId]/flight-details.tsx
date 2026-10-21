import type {ReactNode} from 'react';
import Link from 'next/link';
import type {DetailFlight} from '../../../../../lib/flights/detail-query';
import type {DirectoryProfile} from '../../../../../lib/profiles/directory-query';
import {formatFeedDeparture} from '../../../../../lib/flights/feed-view';
import ProfilePhoto from '../../../_components/profile-photo';
const linkClass='inline-flex min-h-11 w-fit items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4';

/** Action slots remain empty until their tickets provide fresh authorization and behavior. */
export default function FlightDetails({flight,pilot,ownerActions,joinerActions}:{flight:DetailFlight;pilot:DirectoryProfile|null;ownerActions?:ReactNode;joinerActions?:ReactNode}){
 const departure=formatFeedDeparture(flight.departure_at,flight.departure_timezone);
 const status={open:'Open',cancelled:'Cancelled',completed:'Completed'}[flight.status];
 return <article aria-labelledby="flight-route" className="min-w-0 space-y-8 rounded-2xl border border-zinc-200 bg-white p-5 [overflow-wrap:anywhere] sm:p-8 dark:border-zinc-800 dark:bg-zinc-950">
  <header className="space-y-3">
   <p className="text-sm font-medium">{flight.visibility==='PRIVATE'?'Private':'Network'} · {status}</p>
   <h1 id="flight-route" className="text-3xl font-semibold tracking-tight"><span className="sr-only">From </span>{flight.departure_airport}<span aria-hidden="true"> → </span><span className="sr-only"> to </span>{flight.destination_airport}</h1>
  </header>
  <dl className="grid gap-6 sm:grid-cols-2">
   <div><dt className="text-sm text-zinc-600 dark:text-zinc-400">Departure local time</dt><dd className="mt-1 font-medium">{departure?<time dateTime={flight.departure_at}>{departure.localDate} at {departure.localTime}<span className="mt-1 block text-sm font-normal">{departure.timeZone} ({departure.utcOffset})</span></time>:'Departure time unavailable'}</dd></div>
   <div><dt className="text-sm text-zinc-600 dark:text-zinc-400">Aircraft</dt><dd className="mt-1">{flight.aircraft_description}</dd></div>
   <div><dt className="text-sm text-zinc-600 dark:text-zinc-400">Joining-pilot capacity</dt><dd className="mt-1">{flight.pilot_places} {flight.pilot_places===1?'place':'places'}, excluding the posting pilot</dd></div>
  </dl>
  <section aria-labelledby="flight-notes" className="space-y-2">
   <h2 id="flight-notes" className="text-xl font-semibold">Notes</h2>
   <p className="whitespace-pre-line">{flight.notes||'No notes provided.'}</p>
  </section>
  {ownerActions}
  <section aria-labelledby="posting-pilot" className="space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800">
   <h2 id="posting-pilot" className="text-xl font-semibold">Posting pilot</h2>
   {pilot?<div className="flex flex-wrap items-center gap-4">
    <ProfilePhoto userId={pilot.user_id} displayName={pilot.display_name} available={pilot.photoAvailable}/>
    <div className="min-w-0 space-y-1"><p className="text-lg font-medium">{pilot.display_name}</p><p>Home airport: {pilot.home_airport}</p><Link href={`/directory/${pilot.user_id}`} prefetch={false} className={linkClass}>View pilot profile</Link></div>
   </div>:<p className="text-zinc-600 dark:text-zinc-400">Posting pilot information unavailable.</p>}
  </section>
  {joinerActions}
 </article>;
}
