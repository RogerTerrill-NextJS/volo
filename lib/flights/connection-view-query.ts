import 'server-only';
import type {ConnectionResult,FlightConnection} from './connection-query.ts';
import type {FlightDetailResult,DetailFlight} from './detail-query.ts';
import type {DirectoryProfile,NetworkProfileResult} from '../profiles/directory-query.ts';
export type ConnectionViewPorts={connection:(id:unknown)=>Promise<ConnectionResult>;flight:(id:string)=>Promise<FlightDetailResult>;pilot:(id:string)=>Promise<NetworkProfileResult>};
export type ConnectionViewResult={status:'authorized';connection:FlightConnection;flight:DetailFlight;pilot:DirectoryProfile|null}|Exclude<ConnectionResult,{status:'authorized'}>;
function createPorts():ConnectionViewPorts{return {connection:async id=>(await import('./connection-query.ts')).getFlightConnection(id),flight:async id=>(await import('./detail-query.ts')).getFlightDetail(id),pilot:async id=>(await import('../profiles/directory-query.ts')).getNetworkProfile(id)};}
/** Compose existing authorized projections, then recheck approval after optional profile reads. */
export async function getConnectionView(id:unknown,ports:ConnectionViewPorts=createPorts()):Promise<ConnectionViewResult>{
 try{
  const first=await ports.connection(id);if(first.status!=='authorized')return first;
  const connection=first.connection;
  const [detail,profile]=await Promise.all([ports.flight(connection.flightId),ports.pilot(connection.counterpartId).catch(()=>({status:'unavailable'} as const))]);
  if(detail.status!=='authorized')return detail;
  if(detail.flight.id!==connection.flightId||detail.flight.owner_id!==connection.ownerId||detail.flight.isOwn!==connection.isOwner||detail.flight.status!=='open')return {status:'missing'};
  if(profile.status==='unauthenticated'||profile.status==='forbidden')return {status:profile.status};
  if(profile.status==='authorized'&&profile.profile.user_id!==connection.counterpartId)return {status:'unavailable'};
  const current=await ports.connection(connection.requestId);if(current.status!=='authorized')return current;
  if(Object.keys(connection).some(key=>connection[key as keyof FlightConnection]!==current.connection[key as keyof FlightConnection]))return {status:'forbidden'};
  return {status:'authorized',connection:current.connection,flight:detail.flight,pilot:profile.status==='authorized'?profile.profile:null};
 }catch{return {status:'unavailable'};}
}
