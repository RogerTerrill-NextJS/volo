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
async function readReports(after:unknown,ports:ReportQueryPorts,adminOnly:boolean):Promise<Result>{
 try{
  const before=await ports.access();if(before.status!=='authorized')return {status:before.status};if(adminOnly&&before.member.role!=='admin')return {status:'forbidden'};
  if(after!==undefined&&(typeof after!=='string'||!reportUuid.test(after)))return {status:'invalid'};
  const data=await ports.read(typeof after==='string'?after:null);if(!Array.isArray(data)||data.length>51)throw Error('Invalid report list');
  const rows=data.map(project);let previous=typeof after==='string'?after:'';for(const row of rows){if(row.id<=previous||(before.member.role!=='admin'&&row.reporter_id!==before.member.userId))throw Error('Invalid report scope');previous=row.id;}
  const current=await ports.access();if(current.status!=='authorized')return {status:current.status};if(current.member.userId!==before.member.userId||current.member.role!==before.member.role)return {status:'forbidden'};
  return {status:'authorized',rows:rows.slice(0,50),nextCursor:rows.length>50?rows[49].id:null};
 }catch{return {status:'unavailable'};}
}

export function listReports(after:unknown=undefined,ports:ReportQueryPorts=createPorts()){return readReports(after,ports,false);}
export function listFounderReports(after:unknown=undefined,ports:ReportQueryPorts=createPorts()){return readReports(after,ports,true);}

export type ReportReceiptPorts={access:()=>Promise<AccessResult>;read:(id:string,reporterId:string)=>Promise<unknown>};
function receiptPorts():ReportReceiptPorts{return {access:async()=>(await import('../auth/access.ts')).getAccess(),async read(id,reporterId){const client=await(await import('../flights/client.ts')).flightMutationClient();const result=await client.from('reports').select('id,reporter_id,target_type,target_id,reason,created_at').eq('id',id).eq('reporter_id',reporterId).limit(1).retry(false);if(result.error)throw Error('Report unavailable');return result.data;}};}
/** A member-facing receipt is always the current reporter's, including for admins. */
export async function getOwnReportReceipt(id:unknown,ports:ReportReceiptPorts=receiptPorts()):Promise<{status:'authorized';report:ReportRow|null}|{status:'unauthenticated'|'forbidden'|'unavailable'|'invalid'}>{
 try{
  const before=await ports.access();if(before.status!=='authorized')return {status:before.status};
  if(typeof id!=='string'||!reportUuid.test(id))return {status:'invalid'};
  const data=await ports.read(id,before.member.userId);if(!Array.isArray(data)||data.length>1)throw Error('Invalid receipt');
  const report=data.length?project(data[0]):null;if(report&&(report.id!==id||report.reporter_id!==before.member.userId))throw Error('Invalid receipt scope');
  const current=await ports.access();if(current.status!=='authorized')return {status:current.status};if(current.member.userId!==before.member.userId||current.member.role!==before.member.role)return {status:'forbidden'};
  return {status:'authorized',report};
 }catch{return {status:'unavailable'};}
}
