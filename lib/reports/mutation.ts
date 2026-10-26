import 'server-only';
import type {MutationPolicy} from '../auth/mutation.ts';
import {reportUuid,reportTime,reportTarget,reportReason,type ReportTarget} from './validation.ts';
export type ReportInput={reportId:string;targetType:ReportTarget;targetId:string;reason:string};
export type ReportResult={code:'reported'|'already_reported';reportId:string;targetType:ReportTarget;targetId:string;createdAt:string}|{code:'target_unavailable'|'report_conflict'|'forbidden'|'invalid_input'|'report_unconfirmed'};
export type ReportPorts={submit:(input:ReportInput)=>Promise<{data:unknown;error:{code?:string}|null}>};
export function parseReport(raw:unknown):ReportInput|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const r=raw as Record<string,unknown>;
 if(Object.keys(r).length!==4||Object.keys(r).some(k=>!['report_id','target_type','target_id','reason'].includes(k))||typeof r.report_id!=='string'||!reportUuid.test(r.report_id.toLowerCase())||!reportTarget(r.target_type)||typeof r.target_id!=='string'||!reportUuid.test(r.target_id.toLowerCase())||typeof r.reason!=='string')return null;
 const reason=r.reason.replace(/\r\n?/g,'\n').trim();if(!reportReason(reason))return null;
 return {reportId:r.report_id.toLowerCase(),targetType:r.target_type,targetId:r.target_id.toLowerCase(),reason};
}
function createPorts():ReportPorts{return {async submit(input){const {flightMutationClient}=await import('../flights/client.ts');return(await flightMutationClient()).rpc('submit_report',{p_report_id:input.reportId,p_target_type:input.targetType,p_target_id:input.targetId,p_reason:input.reason}).retry(false);}};}
/** SQL owns current target entitlement, reporter identity and exact retry binding. */
export function reportPolicy(ports:ReportPorts=createPorts()):MutationPolicy<ReportInput,ReportResult>{return {
 allowedRoles:['member','admin'],parse(raw){const value=parseReport(raw);return value?{ok:true,value}:{ok:false};},authorize(){return true;},
 async effect(_member,input){
  try{
   const {data,error}=await ports.submit(input);
   if(error)return {code:error.code==='42501'?'forbidden':error.code==='22023'?'invalid_input':'report_unconfirmed'};
   if(data&&typeof data==='object'&&!Array.isArray(data)){
    const r=data as Record<string,unknown>;
    if(r.code==='target_unavailable'||r.code==='report_conflict')return {code:r.code};
    if((r.code==='reported'||r.code==='already_reported')&&r.reportId===input.reportId&&r.targetType===input.targetType&&r.targetId===input.targetId&&reportTime(r.createdAt))return {code:r.code,reportId:input.reportId,targetType:input.targetType,targetId:input.targetId,createdAt:r.createdAt};
   }
  }catch{/* The report may have committed; no automatic retry or unverified success. */}
  return {code:'report_unconfirmed'};
 },
};}
