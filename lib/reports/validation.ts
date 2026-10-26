export {memberAdminUuid as reportUuid,memberAdminTime as reportTime} from '../auth/member-admin-validation.ts';
export type ReportTarget='pilot'|'flight'|'message';
export function reportTarget(value:unknown):value is ReportTarget{return value==='pilot'||value==='flight'||value==='message';}
export function reportReason(value:unknown):value is string{return typeof value==='string'&&value.isWellFormed()&&!value.includes('\u0000')&&value.trim().length>0&&[...value].length<=2000;}
