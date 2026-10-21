import type {FeedFlight} from '../../../../lib/flights/feed-query';
import {formatFeedDeparture} from '../../../../lib/flights/feed-view';

export default function FlightCard({flight}:{flight:FeedFlight}){
 const departure=formatFeedDeparture(flight.departure_at,flight.departure_timezone);
 return <li className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6 dark:border-zinc-800 dark:bg-zinc-950">
  <article aria-labelledby={`flight-${flight.id}`} className="space-y-5 [overflow-wrap:anywhere]">
   <header className="space-y-3">
    <p className="w-fit rounded-full bg-zinc-100 px-3 py-1 text-sm font-medium dark:bg-zinc-900">{flight.visibility==='PRIVATE'?'Private':'Network'}</p>
    <h2 id={`flight-${flight.id}`} className="text-xl font-semibold tracking-tight"><span className="sr-only">From </span>{flight.departure_airport}<span aria-hidden="true"> → </span><span className="sr-only"> to </span>{flight.destination_airport}</h2>
   </header>
   <dl className="space-y-4">
    <div><dt className="text-sm text-zinc-600 dark:text-zinc-400">Departure local time</dt><dd className="mt-1 font-medium">{departure?<time dateTime={flight.departure_at}>{departure.localDate} at {departure.localTime}<span className="mt-1 block text-sm font-normal">{departure.timeZone} ({departure.utcOffset})</span></time>:<span>Departure time unavailable</span>}</dd></div>
    <div><dt className="text-sm text-zinc-600 dark:text-zinc-400">Aircraft</dt><dd className="mt-1">{flight.aircraft_description}</dd></div>
    <div><dt className="text-sm text-zinc-600 dark:text-zinc-400">Joining-pilot capacity</dt><dd className="mt-1">{flight.pilot_places} {flight.pilot_places===1?'place':'places'}, excluding the posting pilot</dd></div>
   </dl>
   <p className="text-sm text-zinc-600 dark:text-zinc-400">{flight.visibility==='PRIVATE'?'Visible to the posting pilot and selected pilots.':'Visible to all active Volo members.'}</p>
  </article>
 </li>;
}
