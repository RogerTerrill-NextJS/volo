import 'server-only';
import type {AccessResult} from '../auth/access.ts';
import type {DetailFlight,FlightDetailResult} from './detail-query.ts';
export type ClosedConnectionPorts={deleted?:(id:string)=>Promise<boolean>;access:()=>Promise<AccessResult>;read:(id:string)=>Promise<unknown>;flight:(id:string)=>Promise<FlightDetailResult>};
type History={requestId:string;flightId:string;requesterId:string;status:'cancelled'|'withdrawn';note:string|null;isOwner:boolean};
export type ClosedConnectionResult={status:'closed';deletedPilot?:boolean;history:History;flight:DetailFlight|null}|{status:'missing'|'unavailable'|'forbidden'|'unauthenticated'};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function createPorts():ClosedConnectionPorts{return {
 deleted:async id=>(await import('../deletion/labels.ts')).requestHasDeletedPilot(id),
 access:async()=>(await import('../auth/access.ts')).getAccess(),
 flight:async id=>(await import('./detail-query.ts')).getFlightDetail(id),
 async read(id){
  const client=await(await import('./client.ts')).flightMutationClient();
  // Participant RLS preserves request history independently of current PRIVATE selection.
  const result=await client.from('flight_requests').select('id,flight_id,requester_id,status,introductory_note').eq('id',id).retry(false).maybeSingle();
  if(result.error)throw Error('History unavailable');return result.data;
 },
};}
function project(value:unknown,id:string,viewer:string):History|null{
 if(value===null)return null;
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid history');
 const row=value as Record<string,unknown>;
 if(row.id!==id||typeof row.flight_id!=='string'||!uuid.test(row.flight_id)||typeof row.requester_id!=='string'||!uuid.test(row.requester_id)
  ||typeof row.status!=='string'||!['pending','accepted','declined','cancelled','withdrawn'].includes(row.status)
  ||(row.introductory_note!==null&&(typeof row.introductory_note!=='string'||!row.introductory_note.isWellFormed()||row.introductory_note.includes('\u0000')||[...row.introductory_note].length>500)))throw Error('Invalid history');
 if(row.status!=='cancelled'&&row.status!=='withdrawn')return null;
 return {requestId:id,flightId:row.flight_id,requesterId:row.requester_id,status:row.status,note:row.introductory_note as string|null,isOwner:viewer!==row.requester_id};
}
/** Read-only retained history, never an active connection or a current flight visibility grant. */
export async function getClosedConnection(id:unknown,ports:ClosedConnectionPorts=createPorts()):Promise<ClosedConnectionResult>{
 try{
  const before=await ports.access();if(before.status!=='authorized')return {status:before.status};
  if(typeof id!=='string'||!uuid.test(id.toLowerCase()))return {status:'missing'};
  const target=id.toLowerCase(),viewer=before.member.userId;
  const history=project(await ports.read(target),target,viewer);if(!history)return {status:'missing'};
  const permitted=(detail:FlightDetailResult)=>detail.status==='authorized'&&detail.flight.id===history.flightId&&detail.flight.isOwn===history.isOwner&&(history.isOwner?detail.flight.owner_id===viewer:detail.flight.owner_id!==viewer);
  const first=await ports.flight(history.flightId);
  if(first.status!=='authorized'&&first.status!=='missing')return {status:first.status};
  if((first.status==='authorized'&&!permitted(first))||(history.isOwner&&!permitted(first)))return {status:'missing'};
  const detail=await ports.flight(history.flightId);
  // Flight/profile reads may be slow; confirm closure after their last await.
  const current=project(await ports.read(target),target,viewer);
  if(!current||JSON.stringify(current)!==JSON.stringify(history))return {status:'missing'};
  const deletedPilot=await ports.deleted?.(target);
  const after=await ports.access();
  if(after.status!=='authorized')return {status:after.status};
  if(after.member.userId!==viewer)return {status:'forbidden'};
  if(detail.status!=='authorized'&&detail.status!=='missing')return {status:detail.status};
  if((detail.status==='authorized'&&!permitted(detail))||(history.isOwner&&!permitted(detail)))return {status:'missing'};
  return {status:'closed',...(deletedPilot?{deletedPilot:true}:{}),history:current,flight:detail.status==='authorized'?detail.flight:null};
 }catch{return {status:'unavailable'};}
}
