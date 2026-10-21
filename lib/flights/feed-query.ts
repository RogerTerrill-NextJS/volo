import 'server-only';
import type {AccessResult} from '../auth/access.ts';
import type {Database} from '../supabase/database.types';
import {normalizeAirportIdentifier} from '../validation/airport.ts';

export type FlightFeedCriteria={departureAirport?:string;destinationAirport?:string;dateFrom?:string;dateTo?:string};
type Position={departureAt:string;id:string};
export type FlightFeedPage={criteria:FlightFeedCriteria;after:Position|null;pageSize:number;now:string};
export type FlightFeedPorts={access:()=>Promise<AccessResult>;now:()=>number;readRows:(page:FlightFeedPage)=>Promise<unknown>};
export type FeedFlight=Pick<Database['public']['Tables']['flights']['Row'],'id'|'owner_id'|'departure_airport'|'destination_airport'|'departure_at'|'departure_timezone'|'departure_local_date'|'aircraft_description'|'pilot_places'|'visibility'>;
export type FlightFeedResult={status:'authorized';rows:FeedFlight[];nextCursor:string|null}|{status:'unauthenticated'|'forbidden'|'unavailable'|'invalid'};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const columns='id,owner_id,departure_airport,destination_airport,departure_at,departure_timezone,departure_local_date,aircraft_description,pilot_places,visibility,status';
const criteriaKeys=['departureAirport','destinationAirport','dateFrom','dateTo'];
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const unavailable=()=>new Error('Flight feed unavailable.');
function date(value:unknown):value is string{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000'))return false;
 const instant=new Date(value+'T00:00:00Z');
 return Number.isFinite(instant.getTime())&&instant.toISOString().slice(0,10)===value;
}
/** PostgreSQL has microseconds; never round a pagination boundary to JS milliseconds. */
function timestamp(value:unknown):string|null{
 if(typeof value!=='string')return null;
 const match=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(value);
 if(!match||!date(match[1])||Number(match[2])>23||Number(match[3])>59||Number(match[4])>59)return null;
 return `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${(match[5]??'').padEnd(6,'0')}Z`;
}
function criteria(input:Record<string,unknown>):FlightFeedCriteria|null{
 const result:FlightFeedCriteria={};
 for(const key of ['departureAirport','destinationAirport','dateFrom','dateTo'] as const){
  const raw=input[key];if(raw===undefined)continue;
  if(typeof raw!=='string'||!raw.isWellFormed()||raw.includes('\u0000'))return null;
  if(!raw.trim())continue;
  if(key==='departureAirport'||key==='destinationAirport'){
   const value=normalizeAirportIdentifier(raw);if(!value)return null;result[key]=value;
  }else{const value=raw.trim();if(!date(value))return null;result[key]=value;}
 }
 if(result.dateFrom&&result.dateTo&&result.dateFrom>result.dateTo)return null;
 return result;
}
function pageInput(raw:unknown,now:string):FlightFeedPage|null{
 if(!object(raw)||Object.keys(raw).some(key=>![...criteriaKeys,'pageSize','after'].includes(key)))return null;
 const filters=criteria(raw),pageSize=raw.pageSize===undefined?20:raw.pageSize;
 if(!filters||typeof pageSize!=='number'||!Number.isInteger(pageSize)||pageSize<1||pageSize>50)return null;
 let after:Position|null=null;
 if(raw.after!==undefined&&raw.after!==null){
  if(typeof raw.after!=='string'||raw.after.length>2048)return null;
  let cursor:unknown;try{cursor=JSON.parse(raw.after);}catch{return null;}
  if(!object(cursor)||Object.keys(cursor).length!==3||!object(cursor.criteria)||Object.keys(cursor.criteria).some(key=>!criteriaKeys.includes(key)))return null;
  const cursorCriteria=criteria(cursor.criteria),departureAt=timestamp(cursor.departureAt);
  if(!cursorCriteria||JSON.stringify(cursorCriteria)!==JSON.stringify(filters)||!departureAt||typeof cursor.id!=='string'||!uuid.test(cursor.id))return null;
  after={departureAt,id:cursor.id.toLowerCase()};
 }
 return {criteria:filters,after,pageSize,now};
}
const position=(row:FeedFlight):Position=>({departureAt:row.departure_at,id:row.id});
const compare=(a:Position,b:Position)=>a.departureAt===b.departureAt?a.id.localeCompare(b.id):a.departureAt<b.departureAt?-1:1;
function project(raw:unknown,page:FlightFeedPage):FeedFlight{
 if(!object(raw))throw unavailable();
 const instant=timestamp(raw.departure_at);
 if(!instant||instant<=page.now||raw.status!=='open'||typeof raw.id!=='string'||!uuid.test(raw.id)||typeof raw.owner_id!=='string'||!uuid.test(raw.owner_id)
  ||typeof raw.departure_airport!=='string'||typeof raw.destination_airport!=='string'||normalizeAirportIdentifier(raw.departure_airport)!==raw.departure_airport||normalizeAirportIdentifier(raw.destination_airport)!==raw.destination_airport
  ||typeof raw.departure_timezone!=='string'||!date(raw.departure_local_date)||(raw.visibility!=='NETWORK'&&raw.visibility!=='PRIVATE')
  ||typeof raw.aircraft_description!=='string'||!raw.aircraft_description.isWellFormed()||raw.aircraft_description.includes('\u0000')||raw.aircraft_description.trim()!==raw.aircraft_description||!raw.aircraft_description||[...raw.aircraft_description].length>500
  ||typeof raw.pilot_places!=='number'||!Number.isInteger(raw.pilot_places)||raw.pilot_places<1||raw.pilot_places>2147483647)throw unavailable();
 // Validate the database-derived calendar date without truncating cursor precision.
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:raw.departure_timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant)).map(p=>[p.type,p.value]));
 if(`${parts.year.padStart(4,'0')}-${parts.month}-${parts.day}`!==raw.departure_local_date)throw unavailable();
 const c=page.criteria;
 if(c.departureAirport&&raw.departure_airport!==c.departureAirport||c.destinationAirport&&raw.destination_airport!==c.destinationAirport||c.dateFrom&&raw.departure_local_date<c.dateFrom||c.dateTo&&raw.departure_local_date>c.dateTo)throw unavailable();
 return {id:raw.id.toLowerCase(),owner_id:raw.owner_id.toLowerCase(),departure_airport:raw.departure_airport,destination_airport:raw.destination_airport,departure_at:instant,departure_timezone:raw.departure_timezone,departure_local_date:raw.departure_local_date,aircraft_description:raw.aircraft_description,pilot_places:raw.pilot_places,visibility:raw.visibility};
}
/** Ordinary session credentials preserve flight RLS. No recipient or membership joins. */
export function createFlightFeedPorts():FlightFeedPorts{
 return {access:async()=>(await import('../auth/access.ts')).getAccess(),now:()=>Date.now(),async readRows(page){
  // Reuse the existing five-second request/body deadline and no-store transport.
  const {flightMutationClient}=await import('./client.ts');
  const client=await flightMutationClient();
  let query=client.from('flights').select(columns).eq('status','open').gt('departure_at',page.now).order('departure_at').order('id').limit(page.pageSize+1);
  const c=page.criteria;
  if(c.departureAirport)query=query.eq('departure_airport',c.departureAirport);
  if(c.destinationAirport)query=query.eq('destination_airport',c.destinationAirport);
  if(c.dateFrom)query=query.gte('departure_local_date',c.dateFrom);
  if(c.dateTo)query=query.lte('departure_local_date',c.dateTo);
  // Both values have strict grammar validation; callers cannot inject PostgREST filters.
  if(page.after)query=query.or(`departure_at.gt.${page.after.departureAt},and(departure_at.eq.${page.after.departureAt},id.gt.${page.after.id})`);
  const result=await query.retry(false);if(result.error)throw unavailable();return result.data;
 }};
}
/** Fresh membership on both sides of every read; a cursor conveys no access grant. */
export async function listUpcomingFlights(input:unknown={},ports:FlightFeedPorts=createFlightFeedPorts()):Promise<FlightFeedResult>{
 try{
  const before=await ports.access();if(before.status!=='authorized')return {status:before.status};
  const now=timestamp(new Date(ports.now()).toISOString());if(!now)throw unavailable();
  const page=pageInput(input,now);if(!page)return {status:'invalid'};
  const data=await ports.readRows(page);if(!Array.isArray(data)||data.length>page.pageSize+1)throw unavailable();
  const rows=data.map(row=>project(row,page));let previous=page.after;
  for(const row of rows){const current=position(row);if(previous&&compare(current,previous)<=0)throw unavailable();previous=current;}
  const after=await ports.access();if(after.status!=='authorized')return {status:after.status};
  if(before.member.userId!==after.member.userId)return {status:'forbidden'};
  const visible=rows.slice(0,page.pageSize);
  return {status:'authorized',rows:visible,nextCursor:rows.length>page.pageSize?JSON.stringify({...position(visible[visible.length-1]),criteria:page.criteria}):null};
 }catch{return {status:'unavailable'};}
}
