import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseMemberDisable,memberDisablePolicy} from '../lib/auth/member-admin-mutation.ts';
import {listAdminMembers,type MemberOverviewPorts} from '../lib/auth/member-admin-query.ts';
const actor='21300000-0000-4000-8000-000000000001',target='21300000-0000-4000-8000-000000000002',at='2026-10-25T12:00:00.123456+00:00';
const member={userId:actor,role:'admin' as const},input={targetId:target,reason:'Safety review'};
const row={userId:target,displayName:'Pilot',role:'member',status:'active',createdAt:at,disabledAt:null,disabledReason:null,disabledReasonTruncated:false};
const ports=():MemberOverviewPorts=>({access:async()=>({status:'authorized',member}),read:async()=>[row]});
test('disable input requires exact target reason and explicit confirmation without actor/role/time fields',()=>{
 assert.deepEqual(parseMemberDisable({target_id:target.toUpperCase(),reason:' Safety review\r\n ',confirmation:'disable'}),input);
 for(const value of [null,{},[],{target_id:target,reason:'Reason'},{target_id:target,reason:' ',confirmation:'disable'},{target_id:target,reason:'x'.repeat(501),confirmation:'disable'},{target_id:target,reason:'Reason',confirmation:'disable',actor_id:actor},{target_id:target,reason:'\u0000',confirmation:'disable'}])assert.equal(parseMemberDisable(value),null);
});
test('disable policy requires admin and confirms only exact target and canonical timestamp',async()=>{
 const policy=memberDisablePolicy({disable:async value=>{assert.deepEqual(value,input);return {data:{code:'disabled',userId:target,disabledAt:at},error:null};}});
 assert.deepEqual(policy.allowedRoles,['admin']);assert.equal(await policy.authorize({userId:actor,role:'member'},input),false);
 assert.deepEqual(await policy.effect(member,input),{code:'disabled',userId:target,disabledAt:at});
 for(const data of [null,{}, {code:'disabled',userId:actor,disabledAt:at},{code:'disabled',userId:target,disabledAt:'bad'},{code:'provider-secret'}])assert.deepEqual(await memberDisablePolicy({disable:async()=>({data,error:null})}).effect(member,input),{code:'disable_unconfirmed'});
});
test('disable failures stay sanitized and never automatically repeat ambiguous writes',async()=>{
 for(const [dbCode,code] of [['42501','forbidden'],['22023','invalid_input'],['XX000','disable_unconfirmed']]){let calls=0;assert.deepEqual(await memberDisablePolicy({disable:async()=>{calls++;return {data:null,error:{code:dbCode}};}}).effect(member,input),{code});assert.equal(calls,1);}
 assert.deepEqual(await memberDisablePolicy({disable:async()=>{throw Error('private-canary');}}).effect(member,input),{code:'disable_unconfirmed'});
});
test('overview strips provider fields and uses bounded UUID pagination',async()=>{
 const result=await listAdminMembers(undefined,{...ports(),read:async()=>[{...row,email:'private-canary',metadata:{role:'admin'}}]});assert.deepEqual(result,{status:'authorized',rows:[row],nextCursor:null});assert.ok(!JSON.stringify(result).includes('private-canary'));
 const rows=Array.from({length:51},(_,n)=>({...row,userId:`21300000-0000-4000-8000-${String(n+2).padStart(12,'0')}`}));
 const page=await listAdminMembers(undefined,{...ports(),read:async()=>rows});assert.equal(page.status,'authorized');if(page.status==='authorized'){assert.equal(page.rows.length,50);assert.equal(page.nextCursor,rows[49].userId);}
 assert.deepEqual(await listAdminMembers('bad',{...ports(),read:async()=>assert.fail('No invalid query')}),{status:'invalid'});
});
test('overview rejects non-admin/current role loss, malformed ordering and inconsistent disabled metadata',async()=>{
 assert.deepEqual(await listAdminMembers(undefined,{...ports(),access:async()=>({status:'authorized',member:{...member,role:'member'}}),read:async()=>assert.fail('No member read')}),{status:'forbidden'});
 let reads=0;assert.deepEqual(await listAdminMembers(undefined,{...ports(),access:async()=>({status:'authorized',member:{...member,role:++reads===1?'admin':'member'}})}),{status:'forbidden'});
 for(const rows of [[row,row],[{...row,status:'disabled'}],[{...row,disabledReason:'unexpected'}],[{...row,role:'owner'}]])assert.deepEqual(await listAdminMembers(undefined,{...ports(),read:async()=>rows}),{status:'unavailable'});
});
test('overview accepts schema-valid existing disabled memberships whose imported disable time precedes creation',async()=>{
 const existing={...row,status:'disabled',disabledAt:'2026-10-25T11:59:59Z',disabledReason:'Imported disable'};
 assert.deepEqual(await listAdminMembers(undefined,{...ports(),read:async()=>[existing]}),{status:'authorized',rows:[existing],nextCursor:null});
});
test('overview safely projects legacy long or newline reasons without breaking the page',async()=>{
 for(const reason of ['x'.repeat(501),'\n']){
  const existing={...row,status:'disabled',disabledAt:at,disabledReason:reason};
  const expected={...existing,disabledReason:reason.slice(0,500),disabledReasonTruncated:reason.length>500};
  assert.deepEqual(await listAdminMembers(undefined,{...ports(),read:async()=>[existing]}),{status:'authorized',rows:[expected],nextCursor:null});
 }
});
