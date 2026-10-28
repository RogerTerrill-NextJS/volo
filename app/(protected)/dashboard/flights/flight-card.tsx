import Link from '../../../_components/progress-link';
import type {FeedFlight} from '../../../../lib/flights/feed-query';
import {formatFeedDeparture} from '../../../../lib/flights/feed-view';

export default function FlightCard({flight}:{flight:FeedFlight}){
 const departure=formatFeedDeparture(flight.departure_at,flight.departure_timezone);
 return <li className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
  <article aria-labelledby={`flight-${flight.id}`} className="space-y-5 [overflow-wrap:anywhere]">
   <header className="space-y-3">
    <div className="flex flex-wrap items-center gap-2"><p className="w-fit rounded-full bg-zinc-100 px-3 py-1 text-sm font-medium">{flight.visibility==='PRIVATE'?'Private':'Network'}</p>{flight.isOwn&&<span className="w-fit rounded-full border border-zinc-400 px-3 py-1 text-sm font-semibold">Your flight</span>}</div>
    <h2 id={`flight-${flight.id}`} className="text-xl font-semibold tracking-tight"><Link href={`/dashboard/flights/${flight.id}`} prefetch={false} className="inline-flex min-h-11 flex-wrap items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"><span className="sr-only">From </span>{flight.departure_airport}<span aria-hidden="true"> → </span><span className="sr-only"> to </span>{flight.destination_airport}</Link></h2>
   </header>
   <dl className="space-y-4">
    <div><dt className="text-sm text-zinc-600">Departure local time</dt><dd className="mt-1 font-medium">{departure?<time dateTime={flight.departure_at}>{departure.localDate} at {departure.localTime}<span className="mt-1 block text-sm font-normal">{departure.timeZone} ({departure.utcOffset})</span></time>:<span>Departure time unavailable</span>}</dd></div>
    <div><dt className="text-sm text-zinc-600">Aircraft</dt><dd className="mt-1">{flight.aircraft_description}</dd></div>
    <div><dt className="text-sm text-zinc-600">Joining-pilot capacity</dt><dd className="mt-1">{flight.pilot_places} {flight.pilot_places===1?'place':'places'}, excluding the posting pilot</dd></div>
   </dl>
   <p className="text-sm text-zinc-600">{flight.visibility==='PRIVATE'?'Visible to the posting pilot and selected pilots.':'Visible to all active Volo members.'}</p>
  </article>
 </li>;
}
