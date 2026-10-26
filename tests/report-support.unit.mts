import assert from 'node:assert/strict';
import {test} from 'node:test';
import {reportHref,parseReportPage} from '../lib/reports/links.ts';
import {emptyReportForm,reportFormResult} from '../lib/reports/form-state.ts';
import {getOwnReportReceipt,listFounderReports,type ReportReceiptPorts} from '../lib/reports/query.ts';
const reporter='21800000-0000-4000-8000-000000000001',target='21800000-0000-4000-8000-000000000002',id='21800000-0000-4000-8000-000000000003',at='2026-10-26T05:00:00.123456+00:00';
const member={userId:reporter,role:'member' as const},row={id,reporter_id:reporter,target_type:'message',target_id:target,reason:'Safety concern',created_at:at};
const form=()=>{const f=new FormData();f.set('report_id',id);f.set('target_type','message');f.set('target_id',target);f.set('reason',' Safety concern\r\n ');return f;};
const ports=():ReportReceiptPorts=>({access:async()=>({status:'authorized',member}),read:async(reportId,reporterId)=>{assert.equal(reportId,id);assert.equal(reporterId,reporter);return [row];}});
test('context links carry only validated reference IDs and canonical report identity',()=>{
 assert.equal(reportHref('message',target),`/reports?target_type=message&target_id=${target}`);
 assert.equal(reportHref('flight',target,id),`/reports?target_type=flight&target_id=${target}&report_id=${id}`);
 assert.equal(reportHref('pilot','https://foreign.invalid'),null);
 assert.deepEqual(parseReportPage({}),{kind:'landing'});
 assert.deepEqual(parseReportPage({target_type:'message',target_id:target}),{kind:'target',targetType:'message',targetId:target,reportId:null});
 for(const params of [{target_type:'message'},{target_type:['pilot'],target_id:target},{target_type:'message',target_id:target,report_id:'bad'},{target_type:'message',target_id:target,reason:'private-canary'},{after:'bad'}])assert.deepEqual(parseReportPage(params),{kind:'invalid'});
});
test('report form confirms only the exact ID, target, bounded reason and canonical server receipt',()=>{
 const result={code:'reported',reportId:id,targetType:'message',targetId:target,createdAt:at};
 for(const code of ['reported','already_reported']){const state=reportFormResult(emptyReportForm,form(),{...result,code,body:'private-canary'});assert.equal(state.status,'received');assert.equal(state.reason,'');assert.ok(!JSON.stringify(state).includes('private-canary'));}
 for(const outcome of [null,{...result,reportId:target},{...result,targetId:reporter},{...result,targetType:'flight'},{...result,createdAt:'bad'}])assert.equal(reportFormResult(emptyReportForm,form(),outcome).status,'unconfirmed');
 const invalid=form();invalid.set('reason',' ');assert.notEqual(reportFormResult(emptyReportForm,invalid,result).status,'received');
});
test('uncertain reports retain safe reason, freeze sends and never trust provider messages',()=>{
 const state=reportFormResult(emptyReportForm,form(),{code:'report_unconfirmed',message:'private-provider-canary'});assert.equal(state.status,'unconfirmed');assert.equal(state.reason,'Safety concern');assert.match(state.message??'',/Check report status/);assert.ok(!JSON.stringify(state).includes('private-provider-canary'));
 assert.equal(reportFormResult(emptyReportForm,form(),{code:'invalid_input'}).status,'invalid');
 for(const code of ['forbidden','unauthenticated','target_unavailable','report_conflict'])assert.equal(reportFormResult(emptyReportForm,form(),{code}).status,'denied');
});
test('own receipt is bounded, strips provider/content fields and filters the reporter even for admins',async()=>{
 assert.deepEqual(await getOwnReportReceipt(id,ports()),{status:'authorized',report:row});
 assert.deepEqual(await getOwnReportReceipt(id,{...ports(),access:async()=>({status:'authorized',member:{...member,role:'admin'}}),read:async(reportId,reporterId)=>{assert.equal(reporterId,reporter);return [{...row,body:'private-canary'}];}}),{status:'authorized',report:row});
 assert.deepEqual(await getOwnReportReceipt(id,{...ports(),read:async()=>[]}),{status:'authorized',report:null});
 for(const rows of [[{...row,reporter_id:target}],[{...row,id:target}],[row,row],[{...row,created_at:'bad'}]])assert.deepEqual(await getOwnReportReceipt(id,{...ports(),read:async()=>rows}),{status:'unavailable'});
});
test('receipt recovery rejects invalid IDs and revocation/identity changes before returning data',async()=>{
 assert.deepEqual(await getOwnReportReceipt('bad',{...ports(),read:async()=>assert.fail('No invalid lookup')}),{status:'invalid'});
 for(const status of ['unauthenticated','forbidden','unavailable'] as const)assert.deepEqual(await getOwnReportReceipt(id,{...ports(),access:async()=>({status}),read:async()=>assert.fail('No denied lookup')}),{status});
 let checks=0;assert.deepEqual(await getOwnReportReceipt(id,{...ports(),access:async()=>++checks===1?{status:'authorized',member}:{status:'forbidden'}}),{status:'forbidden'});
 checks=0;assert.deepEqual(await getOwnReportReceipt(id,{...ports(),access:async()=>({status:'authorized',member:{...member,userId:++checks===1?reporter:target}})}),{status:'forbidden'});
});

test('founder list independently requires current admin authority before and after reading',async()=>{
 const own={access:async()=>({status:'authorized' as const,member}),read:async()=>assert.fail('Demoted member must not read founder list')};
 assert.deepEqual(await listFounderReports(undefined,own),{status:'forbidden'});
 let checks=0;assert.deepEqual(await listFounderReports(undefined,{access:async()=>({status:'authorized',member:{...member,role:++checks===1?'admin':'member'}}),read:async()=>[row]}),{status:'forbidden'});
 assert.equal((await listFounderReports(undefined,{access:async()=>({status:'authorized',member:{...member,role:'admin'}}),read:async()=>[row]})).status,'authorized');
});
