import 'server-only';
import {normalizeFlightFeedCriteria,type FlightFeedCriteria} from './feed-query.ts';
import {formatDeparture} from './time.ts';
const fields=['departureAirport','destinationAirport','dateFrom','dateTo'] as const;
export function flightFeedHref(criteria:FlightFeedCriteria,after?:string):string{
 const params=new URLSearchParams();
 for(const field of fields)if(criteria[field])params.set(field,criteria[field]);
 if(after)params.set('after',after);
 return `/dashboard/flights${params.size?'?'+params.toString():''}`;
}
/** Preserve repeated parameters for query validation, never turn them into a silent choice. */
export function readFlightFeedSearch(query:Record<string,string|string[]|undefined>){
 const filters=Object.fromEntries(fields.map(field=>[field,query[field]]));
 const criteria=normalizeFlightFeedCriteria(filters);
 const values=Object.fromEntries(fields.map(field=>[field,criteria?.[field]??(typeof query[field]==='string'?query[field].trim().slice(0,field.endsWith('Airport')?32:10):'')])) as Record<typeof fields[number],string>;
 return {input:{...filters,...(query.after===undefined?{}:{after:query.after})},criteria,values};
}
/** Cards display to seconds. Keep the original instant for <time>, cursors and edits. */
export function formatFeedDeparture(instant:string,zone:string){
 return formatDeparture(instant.replace(/\.\d{6}Z$/,'Z'),zone);
}
