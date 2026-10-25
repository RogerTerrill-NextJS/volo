import 'server-only';
import type {AccessResult} from './access.ts';
import {memberAdminUuid,memberAdminTime} from './member-admin-validation.ts';
export type MemberOverviewRow={userId:string;displayName:string|null;role:'member'|'admin';status:'active'|'disabled';createdAt:string;disabledAt:string|null;disabledReason:string|null;disabledReasonTruncated:boolean};
export type MemberOverviewPorts={access:()=>Promise<AccessResult>;read:(after:string|null)=>Promise<unknown>};
type Result={status:'authorized';rows:MemberOverviewRow[];nextCursor:string|null}|{status:'unauthenticated'|'forbidden'|'unavailable'|'invalid'};
function createPorts():MemberOverviewPorts{return {access:async()=>(await import('./access.ts')).getAccess(),async read(after){const {flightMutationClient}=await import('../flights/client.ts');const r=await(await flightMutationClient()).rpc('admin_member_overview',{p_after_user_id:after??undefined}).retry(false);if(r.error)throw Error('Member overview unavailable');return r.data;}};}
function project(value:unknown):MemberOverviewRow{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid member row');
 const r=value as Record<string,unknown>;
 if(typeof r.userId!=='string'||!memberAdminUuid.test(r.userId)||(r.displayName!==null&&(typeof r.displayName!=='string'||!r.displayName.isWellFormed()||r.displayName.includes('\u0000')||[...r.displayName].length>80))||!['member','admin'].includes(String(r.role))||!['active','disabled'].includes(String(r.status))||!memberAdminTime(r.createdAt))throw Error('Invalid member row');
 if(r.status==='active'?(r.disabledAt!==null||r.disabledReason!==null):(!memberAdminTime(r.disabledAt)||typeof r.disabledReason!=='string'||!r.disabledReason.isWellFormed()||r.disabledReason.includes('\u0000')||!r.disabledReason.replace(/^ +| +$/g,'')))throw Error('Invalid disabled metadata');
 // Existing operator records follow PostgreSQL btrim, not the new write limits.
 const reason=typeof r.disabledReason==='string'?[...r.disabledReason.replace(/^ +| +$/g,'')]:null;
 return {userId:r.userId,displayName:r.displayName as string|null,role:r.role as MemberOverviewRow['role'],status:r.status as MemberOverviewRow['status'],createdAt:r.createdAt,disabledAt:r.disabledAt as string|null,disabledReason:reason?.slice(0,500).join('')??null,disabledReasonTruncated:r.disabledReasonTruncated===true||(reason!==null&&reason.length>500)};
}
export async function listAdminMembers(after:unknown=undefined,ports:MemberOverviewPorts=createPorts()):Promise<Result>{
 try{
  const before=await ports.access();if(before.status!=='authorized')return {status:before.status};if(before.member.role!=='admin')return {status:'forbidden'};
  if(after!==undefined&&(typeof after!=='string'||!memberAdminUuid.test(after)))return {status:'invalid'};
  const data=await ports.read(typeof after==='string'?after:null);if(!Array.isArray(data)||data.length>51)throw Error('Invalid member list');
  const rows=data.map(project);let previous=typeof after==='string'?after:'';for(const row of rows){if(row.userId<=previous)throw Error('Invalid member order');previous=row.userId;}
  const current=await ports.access();if(current.status!=='authorized')return {status:current.status};if(current.member.role!=='admin'||current.member.userId!==before.member.userId)return {status:'forbidden'};
  return {status:'authorized',rows:rows.slice(0,50),nextCursor:rows.length>50?rows[49].userId:null};
 }catch{return {status:'unavailable'};}
}
