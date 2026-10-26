import {reportTarget,reportUuid,type ReportTarget} from './validation.ts';
export function reportHref(targetType:ReportTarget,targetId:string,reportId?:string):string|null{
 if(!reportTarget(targetType)||!reportUuid.test(targetId)||(reportId!==undefined&&!reportUuid.test(reportId)))return null;
 return '/reports?target_type='+targetType+'&target_id='+targetId+(reportId?'&report_id='+reportId:'');
}
type PageInput={kind:'landing'}|{kind:'invalid'}|{kind:'target';targetType:ReportTarget;targetId:string;reportId:string|null};
export function parseReportPage(params:Record<string,unknown>):PageInput{
 const keys=Object.keys(params);if(!keys.length)return {kind:'landing'};
 const {target_type:targetType,target_id:targetId,report_id:reportId}=params;
 if(keys.some(key=>!['target_type','target_id','report_id'].includes(key))||!reportTarget(targetType)||typeof targetId!=='string'||!reportUuid.test(targetId)||(reportId!==undefined&&(typeof reportId!=='string'||!reportUuid.test(reportId))))return {kind:'invalid'};
 return {kind:'target',targetType,targetId,reportId:typeof reportId==='string'?reportId:null};
}
