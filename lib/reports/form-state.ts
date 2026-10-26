import {reportTime,reportReason,reportTarget,reportUuid} from './validation.ts';
export type ReportFormState={revision:number;status:'ready'|'invalid'|'received'|'denied'|'unconfirmed';reason:string;message:string|null};
export const emptyReportForm:ReportFormState={revision:0,status:'ready',reason:'',message:null};
export function reportFormResult(previous:ReportFormState,form:FormData,outcome:unknown):ReportFormState{
 const revision=(Number.isSafeInteger(previous?.revision)?previous.revision:0)+1,raw=form.get('reason'),reason=typeof raw==='string'&&raw.isWellFormed()&&!raw.includes('\u0000')?[...raw.replace(/\r\n?/g,'\n').trim()].slice(0,2000).join(''):'';
 const result=outcome&&typeof outcome==='object'&&!Array.isArray(outcome)?outcome as Record<string,unknown>:{},reportId=form.get('report_id'),targetType=form.get('target_type'),targetId=form.get('target_id');
 if(typeof reportId==='string'&&reportUuid.test(reportId)&&reportTarget(targetType)&&typeof targetId==='string'&&reportUuid.test(targetId)&&typeof raw==='string'&&reportReason(raw.replace(/\r\n?/g,'\n').trim())&&(result.code==='reported'||result.code==='already_reported')&&result.reportId===reportId&&result.targetType===targetType&&result.targetId===targetId&&reportTime(result.createdAt))return {revision,status:'received',reason:'',message:'Report received. The founder reviews reports manually during beta.'};
 const status=['forbidden','unauthenticated','target_unavailable','report_conflict'].includes(String(result.code))?'denied':['invalid_input','too_large'].includes(String(result.code))?'invalid':'unconfirmed';
 const message={denied:'Reporting is unavailable for this account, item or report reference. Check report status before continuing.',invalid:'Describe the concern using 1–2,000 characters.',unconfirmed:'We could not confirm whether your report was received. Check report status before trying again.'}[status];
 return {revision,status,reason,message};
}
