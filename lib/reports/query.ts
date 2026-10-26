import 'server-only';
import type {AccessResult} from '../auth/access.ts';
import {reportUuid,reportTime,reportTarget,reportReason,type ReportTarget} from './validation.ts';
export type ReportRow={id:string;reporter_id:string;target_type:ReportTarget;target_id:string;reason:string;created_at:string};
export type ReportQueryPorts={access:()=>Promise<AccessResult>;read:(after:string|null)=>Promise<unknown>};
type Result={status:'authorized';rows:ReportRow[];nextCursor:string|null}|{status:'unauthenticated'|'forbidden'|'unavailable'|'invalid'};
function createPorts():ReportQueryPorts{return {access:async()=>(await import('../auth/access.ts')).getAccess(),async read(after){const client=await(await import('../flights/client.ts')).flightMutationClient();let query=client.from('reports').select('id,reporter_id,target_type,target_id,reason,created_at').order('id').limit(51);if(after)query=query.gt('id',after);const result=await query.retry(false);if(result.error)throw Error('Reports unavailable');return result.data;}};}
function project(value:unknown):ReportRow{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid report');const r=value as Record<string,unknown>;
 if(typeof r.id!=='string'||!reportUuid.test(r.id)||typeof r.reporter_id!=='string'||!reportUuid.test(r.reporter_id)||!reportTarget(r.target_type)||typeof r.target_id!=='string'||!reportUuid.test(r.target_id)||!reportReason(r.reason)||!reportTime(r.created_at))throw Error('Invalid report');
 return {id:r.id,reporter_id:r.reporter_id,target_type:r.target_type,target_id:r.target_id,reason:r.reason,created_at:r.created_at};
}
/** Session RLS preserves reporter/admin reads; report references grant no target access. */
export async function listReports(after:unknown=undefined,ports:ReportQueryPorts=createPorts()):Promise<Result>{
 try{
  const before=await ports.access();if(before.status!=='authorized')return {status:before.status};
  if(after!==undefined&&(typeof after!=='string'||!reportUuid.test(after)))return {status:'invalid'};
  const data=await ports.read(typeof after==='string'?after:null);if(!Array.isArray(data)||data.length>51)throw Error('Invalid report list');
  const rows=data.map(project);let previous=typeof after==='string'?after:'';for(const row of rows){if(row.id<=previous||(before.member.role!=='admin'&&row.reporter_id!==before.member.userId))throw Error('Invalid report scope');previous=row.id;}
  const current=await ports.access();if(current.status!=='authorized')return {status:current.status};if(current.member.userId!==before.member.userId||current.member.role!==before.member.role)return {status:'forbidden'};
  return {status:'authorized',rows:rows.slice(0,50),nextCursor:rows.length>50?rows[49].id:null};
 }catch{return {status:'unavailable'};}
}
