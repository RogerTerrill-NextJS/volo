import 'server-only';
import type {AccessResult,ActiveMember} from '../auth/access.ts';
import {projectFlightDetail} from './detail-query.ts';
import {normalizeEditInstant} from './edit-input.ts';
import {formatFeedDeparture} from './feed-view.ts';
import {emptyFlightForm,type FlightFormState} from './form-state.ts';
export type EditQueryPorts={access:()=>Promise<AccessResult>;readRow:(id:string,viewer:string)=>Promise<unknown>;readAccepted:(id:string)=>Promise<number>;profile:(member:ActiveMember)=>Promise<'complete'|'missing'|'unavailable'>;now:()=>number};
export type EditQueryResult={status:'authorized';flightId:string;initial:FlightFormState;acceptedCount:number;visibility:'NETWORK'|'PRIVATE'}|{status:'unauthenticated'|'forbidden'|'missing'|'unavailable'|'profile_required'|'closed'};
function createPorts():EditQueryPorts{return {
 access:async()=>(await import('../auth/access.ts')).getAccess(),now:()=>Date.now(),profile:async m=>(await import('../profiles/query.ts')).getOwnProfileStatus(m),
 async readRow(id,viewer){const {flightMutationClient}=await import('./client.ts');const r=await(await flightMutationClient()).from('flights').select('id,owner_id,departure_airport,destination_airport,departure_at,departure_timezone,departure_local_date,aircraft_description,pilot_places,notes,status,visibility,updated_at').eq('id',id).eq('owner_id',viewer).retry(false).maybeSingle();if(r.error)throw Error('Edit unavailable');return r.data;},
 async readAccepted(id){const {flightMutationClient}=await import('./client.ts');const r=await(await flightMutationClient()).from('flight_requests').select('id',{count:'exact',head:true}).eq('flight_id',id).eq('status','accepted').retry(false);if(r.error||r.count===null)throw Error('Edit unavailable');return r.count;},
};}
export async function getFlightEdit(id:unknown,ports:EditQueryPorts=createPorts()):Promise<EditQueryResult>{try{
 const before=await ports.access();if(before.status!=='authorized')return {status:before.status};
 if(typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))return {status:'missing'};
 const target=id.toLowerCase(),row=await ports.readRow(target,before.member.userId);
 if(!row||typeof row!=='object'||!('owner_id' in row)||row.owner_id!==before.member.userId)return {status:'missing'};
 const flight=projectFlightDetail(row,target),revision='updated_at' in row?normalizeEditInstant(row.updated_at):null;
 if(!revision)return {status:'unavailable'};
 if(flight.status!=='open'||Date.parse(flight.departure_at)<=ports.now())return {status:'closed'};
 const [profile,acceptedCount]=await Promise.all([ports.profile(before.member),ports.readAccepted(target)]);
 const latest=await ports.readRow(target,before.member.userId),after=await ports.access();if(after.status!=='authorized')return {status:after.status};
 if(after.member.userId!==before.member.userId)return {status:'forbidden'};
 if(!latest||typeof latest!=='object'||!('owner_id' in latest)||latest.owner_id!==before.member.userId||!('updated_at' in latest)||normalizeEditInstant(latest.updated_at)!==revision)return {status:'unavailable'};
 if(profile==='missing')return {status:'profile_required'};if(profile!=='complete'||!Number.isInteger(acceptedCount)||acceptedCount<0||acceptedCount>flight.pilot_places)return {status:'unavailable'};
 const local=formatFeedDeparture(flight.departure_at,flight.departure_timezone);if(!local)return {status:'unavailable'};
 const initial:FlightFormState={...emptyFlightForm,expectedUpdatedAt:revision,values:{departure_airport:flight.departure_airport,destination_airport:flight.destination_airport,departure_local_date:local.localDate,departure_local_time:local.localTime,departure_timezone:flight.departure_timezone,departure_occurrence:local.occurrence??'',aircraft_description:flight.aircraft_description,pilot_places:String(flight.pilot_places),notes:flight.notes??''}};
 return {status:'authorized',flightId:target,initial,acceptedCount,visibility:flight.visibility};
}catch{return {status:'unavailable'};}}
