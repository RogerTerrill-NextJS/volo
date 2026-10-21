import 'server-only';
import type {AccessResult} from '../auth/access.ts';
import type {DirectoryProfile,NetworkProfileResult} from '../profiles/directory-query.ts';
import type {FeedFlight} from './feed-query.ts';
import {formatFeedDeparture} from './feed-view.ts';
import {normalizeAirportIdentifier} from '../validation/airport.ts';

export type DetailFlight=FeedFlight & {notes:string|null;status:'open'|'cancelled'|'completed'};
export type FlightDetailPorts={access:()=>Promise<AccessResult>;readRow:(id:string)=>Promise<unknown>;readPilot:(id:string)=>Promise<NetworkProfileResult>};
export type FlightDetailResult={status:'authorized';flight:DetailFlight;pilot:DirectoryProfile|null}|{status:'unauthenticated'|'forbidden'|'unavailable'|'missing'};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const columns='id,owner_id,departure_airport,destination_airport,departure_at,departure_timezone,departure_local_date,aircraft_description,pilot_places,visibility,status,notes';
const unavailable=()=>new Error('Flight detail unavailable.');
const text=(value:unknown):value is string=>typeof value==='string'&&value.isWellFormed()&&!value.includes('\u0000');

function project(input:unknown,target:string):DetailFlight{
 if(!input||typeof input!=='object'||Array.isArray(input))throw unavailable();
 const row=input as Record<string,unknown>;
 if(typeof row.id!=='string'||row.id.toLowerCase()!==target||typeof row.owner_id!=='string'||!uuid.test(row.owner_id)
  ||!text(row.departure_airport)||normalizeAirportIdentifier(row.departure_airport)!==row.departure_airport
  ||!text(row.destination_airport)||normalizeAirportIdentifier(row.destination_airport)!==row.destination_airport
  ||!text(row.departure_at)||!text(row.departure_timezone)||!text(row.departure_local_date)
  ||!text(row.aircraft_description)||!row.aircraft_description.trim()||row.aircraft_description.trim()!==row.aircraft_description||[...row.aircraft_description].length>500
  ||typeof row.pilot_places!=='number'||!Number.isInteger(row.pilot_places)||row.pilot_places<1||row.pilot_places>2147483647
  ||(row.visibility!=='NETWORK'&&row.visibility!=='PRIVATE')||(row.status!=='open'&&row.status!=='cancelled'&&row.status!=='completed')
  ||(row.notes!==null&&(!text(row.notes)||[...row.notes].length>2000)))throw unavailable();
 const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(row.departure_at);
 if(!match)throw unavailable();
 const instant=`${match[1]}.${(match[2]??'').padEnd(6,'0')}Z`;
 const departure=formatFeedDeparture(instant,row.departure_timezone);
 if(!departure||departure.localDate!==row.departure_local_date)throw unavailable();
 return {id:target,owner_id:row.owner_id.toLowerCase(),departure_airport:row.departure_airport,destination_airport:row.destination_airport,departure_at:instant,departure_timezone:row.departure_timezone,departure_local_date:row.departure_local_date,aircraft_description:row.aircraft_description,pilot_places:row.pilot_places,visibility:row.visibility,status:row.status,notes:row.notes};
}

/** Session credentials preserve RLS; no privileged client or recipient/membership joins. */
export function createFlightDetailPorts():FlightDetailPorts{
 return {access:async()=>(await import('../auth/access.ts')).getAccess(),readPilot:async id=>(await import('../profiles/directory-query.ts')).getNetworkProfile(id),async readRow(id){
  const {flightMutationClient}=await import('./client.ts');
  const client=await flightMutationClient();
  const result=await client.from('flights').select(columns).eq('id',id).retry(false).maybeSingle();
  if(result.error)throw unavailable();return result.data;
 }};
}

/** A detail read is independent of upcoming-feed filters. Missing and denied rows look alike. */
export async function getFlightDetail(id:unknown,ports:FlightDetailPorts=createFlightDetailPorts()):Promise<FlightDetailResult>{
 try{
  const before=await ports.access();if(before.status!=='authorized')return {status:before.status};
  if(typeof id!=='string'||!uuid.test(id))return {status:'missing'};
  const target=id.toLowerCase(),data=await ports.readRow(target);
  const flight=data===null?null:project(data,target);
  // Recheck before the optional lookup as well as after it; discard changed viewers.
  const current=await ports.access();if(current.status!=='authorized')return {status:current.status};
  if(current.member.userId!==before.member.userId)return {status:'forbidden'};
  if(!flight)return {status:'missing'};
  const pilot=await ports.readPilot(flight.owner_id);
  if(pilot.status==='unauthenticated'||pilot.status==='forbidden')return {status:pilot.status};
  const after=await ports.access();if(after.status!=='authorized')return {status:after.status};
  if(after.member.userId!==before.member.userId)return {status:'forbidden'};
  return {status:'authorized',flight,pilot:pilot.status==='authorized'?pilot.profile:null};
 }catch{return {status:'unavailable'};}
}
