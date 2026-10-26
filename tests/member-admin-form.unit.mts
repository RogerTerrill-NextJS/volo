import assert from 'node:assert/strict';
import {test} from 'node:test';
import {memberDisableFormResult,emptyMemberDisableForm} from '../lib/auth/member-admin-form-state.ts';
const target='21400000-0000-4000-8000-000000000001',other='21400000-0000-4000-8000-000000000002',at='2026-10-25T12:00:00Z';
const form=()=>{const f=new FormData();f.set('target_id',target);f.set('reason',' Safety review\r\n');f.set('confirmation','disable');return f;};
test('member control confirms only matching target and timestamp and clears the reason on confirmed disable',()=>{
 for(const code of ['disabled','already_disabled']){const result=memberDisableFormResult(emptyMemberDisableForm,form(),{code,userId:target,disabledAt:at});assert.equal(result.status,'disabled');assert.equal(result.reason,'');assert.equal(result.disabledAt,at);assert.equal(result.revision,1);}
 for(const outcome of [{code:'disabled',userId:other,disabledAt:at},{code:'disabled',userId:target,disabledAt:'bad'},{code:'disabled'},null])assert.equal(memberDisableFormResult(emptyMemberDisableForm,form(),outcome).status,'unconfirmed');
});
test('uncertain transport outcomes retain reason and require a status check without exposing provider fields',()=>{
 const result=memberDisableFormResult(emptyMemberDisableForm,form(),{code:'disable_unconfirmed',message:'private-provider-canary'});assert.equal(result.status,'unconfirmed');assert.equal(result.reason,'Safety review');assert.ok(!JSON.stringify(result).includes('private-provider-canary'));assert.match(result.message??'',/Check member status/);
});
test('invalid input remains editable while access or stale-target denial blocks repeat submission',()=>{
 assert.equal(memberDisableFormResult(emptyMemberDisableForm,form(),{code:'invalid_input'}).status,'invalid');
 for(const code of ['forbidden','unauthenticated','self_disable_not_allowed','member_unavailable'])assert.equal(memberDisableFormResult(emptyMemberDisableForm,form(),{code}).status,'denied');
});
