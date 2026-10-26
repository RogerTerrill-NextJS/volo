import 'server-only';
import type {AccessResult} from '../auth/access.ts';
import {memberAdminUuid,memberAdminTime} from '../auth/member-admin-validation.ts';
import {projectFlightDetail} from './detail-query.ts';
export type AdminFlightRow=ReturnType<typeof projectFlightDetail>&{created_at:string;moderated_at:string|null;moderation_reason:string|null};
export type AdminFlightPorts={access:()=>Promise<AccessResult>;read:(after:string|null)=>Promise<unknown>};
type Result={status:'authorized';rows:AdminFlightRow[];nextCursor:string|null}|{status:'unauthenticated'|'forbidden'|'unavailable'|'invalid'};
function createPorts():AdminFlightPorts{return {access:async()=>(await import('../auth/access.ts')).getAccess(),async read(after){const {flightMutationClient}=await import('./client.ts');const result=await(await flightMutationClient()).rpc('admin_flight_overview',{p_after_flight_id:after??undefined}).retry(false);if(result.error)throw Error('Flight moderation unavailable');return result.data;}};}
function project(value:unknown):AdminFlightRow{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid moderation row');
 const r=value as Record<string,unknown>;
 if(typeof r.id!=='string'||!memberAdminUuid.test(r.id)||!memberAdminTime(r.created_at))throw Error('Invalid moderation row');
 const flight=projectFlightDetail(r,r.id);
 if(r.moderated_at===null?r.moderation_reason!==null:(!memberAdminTime(r.moderated_at)||flight.status==='open'||typeof r.moderation_reason!=='string'||!r.moderation_reason.isWellFormed()||r.moderation_reason.includes('\u0000')||![...r.moderation_reason].length||[...r.moderation_reason].length>500||!r.moderation_reason.trim()))throw Error('Invalid hidden metadata');
 return {...flight,created_at:r.created_at,moderated_at:r.moderated_at as string|null,moderation_reason:r.moderation_reason as string|null};
}
/** Explicit moderation read only; ordinary member/participant access stays separate. */
export async function listAdminFlights(after:unknown=undefined,ports:AdminFlightPorts=createPorts()):Promise<Result>{
 try{
  const before=await ports.access();if(before.status!=='authorized')return {status:before.status};if(before.member.role!=='admin')return {status:'forbidden'};
  if(after!==undefined&&(typeof after!=='string'||!memberAdminUuid.test(after)))return {status:'invalid'};
  const data=await ports.read(typeof after==='string'?after:null);if(!Array.isArray(data)||data.length>51)throw Error('Invalid moderation list');
  const rows=data.map(project);let previous=typeof after==='string'?after:'';for(const row of rows){if(row.id<=previous)throw Error('Invalid moderation order');previous=row.id;}
  const current=await ports.access();if(current.status!=='authorized')return {status:current.status};if(current.member.role!=='admin'||current.member.userId!==before.member.userId)return {status:'forbidden'};
  return {status:'authorized',rows:rows.slice(0,50),nextCursor:rows.length>50?rows[49].id:null};
 }catch{return {status:'unavailable'};}
}
