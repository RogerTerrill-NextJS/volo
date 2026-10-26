import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseReport,reportPolicy} from '../lib/reports/mutation.ts';
import {listReports,type ReportQueryPorts} from '../lib/reports/query.ts';
const reporter='21700000-0000-4000-8000-000000000001',target='21700000-0000-4000-8000-000000000002',id='21710000-0000-4000-8000-000000000001',at='2026-10-26T03:00:00.123456+00:00';
const member={userId:reporter,role:'member' as const},input={reportId:id,targetType:'message' as const,targetId:target,reason:'Safety concern'};
const raw={report_id:id,target_type:'message',target_id:target,reason:' Safety concern\r\n '};
const row={id,reporter_id:reporter,target_type:'message',target_id:target,reason:'Safety concern',created_at:at};
const ports=():ReportQueryPorts=>({access:async()=>({status:'authorized',member}),read:async()=>[row]});
test('report input requires one exact target, retry UUID and bounded Unicode reason without authority fields',()=>{
 assert.deepEqual(parseReport(raw),input);assert.equal(parseReport({...raw,reason:'😀'.repeat(2000)})?.reason.length,4000);
 for(const value of [null,{},[],{...raw,report_id:'bad'},{...raw,target_type:'conversation'},{...raw,target_id:'bad'},{...raw,reason:' '},{...raw,reason:'x'.repeat(2001)},{...raw,reason:'\u0000'},{...raw,reason:'\ud800'},{...raw,reporter_id:target},{...raw,status:'resolved'}])assert.equal(parseReport(value),null);
});
test('report policy confirms only matching retry ID and target with canonical server time',async()=>{
 const expected={code:'reported',reportId:id,targetType:'message',targetId:target,createdAt:at};
 const policy=reportPolicy({submit:async value=>{assert.deepEqual(value,input);return {data:{...expected,body:'private-canary'},error:null};}});
 assert.deepEqual(policy.allowedRoles,['member','admin']);assert.deepEqual(await policy.effect(member,input),expected);
 for(const data of [null,{}, {...expected,reportId:target},{...expected,targetId:reporter},{...expected,targetType:'pilot'},{...expected,createdAt:'bad'}])assert.deepEqual(await reportPolicy({submit:async()=>({data,error:null})}).effect(member,input),{code:'report_unconfirmed'});
});
test('report errors are fixed and uncertain writes never retry automatically',async()=>{
 for(const [dbCode,code] of [['42501','forbidden'],['22023','invalid_input'],['XX000','report_unconfirmed']]){let calls=0;assert.deepEqual(await reportPolicy({submit:async()=>{calls++;return {data:null,error:{code:dbCode}};}}).effect(member,input),{code});assert.equal(calls,1);}
 for(const code of ['target_unavailable','report_conflict'])assert.deepEqual(await reportPolicy({submit:async()=>({data:{code,message:'canary'},error:null})}).effect(member,input),{code});
 assert.deepEqual(await reportPolicy({submit:async()=>{throw Error('canary');}}).effect(member,input),{code:'report_unconfirmed'});
});
test('report list strips target content/provider fields and bounds UUID pagination',async()=>{
 assert.deepEqual(await listReports(undefined,{...ports(),read:async()=>[{...row,body:'private-canary',email:'private-canary'}]}),{status:'authorized',rows:[row],nextCursor:null});
 const rows=Array.from({length:51},(_,n)=>({...row,id:`21710000-0000-4000-8000-${String(n+1).padStart(12,'0')}`}));const result=await listReports(undefined,{...ports(),read:async()=>rows});assert.equal(result.status,'authorized');if(result.status==='authorized'){assert.equal(result.rows.length,50);assert.equal(result.nextCursor,rows[49].id);}
 assert.deepEqual(await listReports('bad',{...ports(),read:async()=>assert.fail('Invalid read')}),{status:'invalid'});
});
test('report list rejects foreign member rows, malformed data and access/role changes',async()=>{
 for(const rows of [[{...row,reporter_id:target}],[row,row],[{...row,target_type:'conversation'}],[{...row,reason:'x'.repeat(2001)}],[{...row,created_at:'bad'}]])assert.deepEqual(await listReports(undefined,{...ports(),read:async()=>rows}),{status:'unavailable'});
 assert.equal((await listReports(undefined,{...ports(),access:async()=>({status:'authorized',member:{...member,role:'admin'}}),read:async()=>[{...row,reporter_id:target}]})).status,'authorized');
 for(const status of ['unauthenticated','forbidden','unavailable'] as const)assert.deepEqual(await listReports(undefined,{...ports(),access:async()=>({status}),read:async()=>assert.fail('Denied read')}),{status});
 let checks=0;assert.deepEqual(await listReports(undefined,{...ports(),access:async()=>({status:'authorized',member:{...member,role:++checks===1?'admin':'member'}})}),{status:'forbidden'});
});
