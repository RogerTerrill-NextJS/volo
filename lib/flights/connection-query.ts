import 'server-only';
import type {AccessResult} from '../auth/access.ts';
export type FlightConnection={requestId:string;flightId:string;ownerId:string;requesterId:string;counterpartId:string;isOwner:boolean};
export type ConnectionResult={status:'authorized';connection:FlightConnection}|{status:'missing'|'unavailable'|'forbidden'|'unauthenticated'};
export type ConnectionPorts={access:()=>Promise<AccessResult>;read:(request:string)=>Promise<unknown>};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function createPorts():ConnectionPorts{return {
 access:async()=>(await import('../auth/access.ts')).getAccess(),
 async read(request){const {flightMutationClient}=await import('./client.ts');const result=await(await flightMutationClient()).rpc('get_flight_connection',{p_request_id:request}).retry(false);if(result.error)throw Error('Connection unavailable');return result.data;},
};}
function project(data:unknown,target:string,viewer:string):FlightConnection|null{
 if(data===null)return null;
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Connection unavailable');
 const row=data as Record<string,unknown>;
 if(row.requestId!==target||![row.flightId,row.ownerId,row.requesterId].every(value=>typeof value==='string'&&uuid.test(value))||row.ownerId===row.requesterId)throw Error('Connection unavailable');
 if(viewer!==row.ownerId&&viewer!==row.requesterId)return null;
 const isOwner=viewer===row.ownerId;
 return {requestId:target,flightId:row.flightId as string,ownerId:row.ownerId as string,requesterId:row.requesterId as string,counterpartId:(isOwner?row.requesterId:row.ownerId) as string,isOwner};
}
/** Ordinary-session read; never cache approval or turn retained history into a grant. */
export async function getFlightConnection(id:unknown,ports:ConnectionPorts=createPorts()):Promise<ConnectionResult>{
 try{
  const before=await ports.access();if(before.status!=='authorized')return {status:before.status};
  if(typeof id!=='string'||!uuid.test(id.toLowerCase()))return {status:'missing'};
  const target=id.toLowerCase(),viewer=before.member.userId,first=project(await ports.read(target),target,viewer);
  if(!first)return {status:'missing'};
  // A withdrawal, cancellation, removal or membership change during this read
  // must not leave a connection projected from the earlier approved snapshot.
  const current=project(await ports.read(target),target,viewer),after=await ports.access();
  if(after.status!=='authorized')return {status:after.status};
  if(after.member.userId!==viewer)return {status:'forbidden'};
  if(!current)return {status:'missing'};
  if(current.flightId!==first.flightId||current.ownerId!==first.ownerId||current.requesterId!==first.requesterId)return {status:'unavailable'};
  return {status:'authorized',connection:current};
 }catch{return {status:'unavailable'};}
}
