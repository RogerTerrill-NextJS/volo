import assert from 'node:assert/strict';
import {test} from 'node:test';
import {interestFormResult,emptyInterestForm} from '../lib/flights/interest-form-state.ts';
const form=()=>{const f=new FormData();f.set('introductory_note','Hello pilot');f.set('owner_id','private-canary');return f;};
const id='19000000-0000-4000-8000-000000000001';
test('confirmed interest becomes pending or accepted and clears the draft',()=>{
 for(const [code,status,want] of [['submitted','pending','pending'],['already_requested','pending','pending'],['already_requested','accepted','accepted']] as const){
  const result=interestFormResult(emptyInterestForm,form(),{code,status,requestId:id});assert.equal(result.status,want);assert.equal(result.note,'');assert.equal(result.revision,1);
 }
});
test('uncertain writes preserve a bounded draft and block resubmission instead of claiming success',()=>{
 for(const result of [{code:'unavailable'},{code:'internal_error'},{code:'submitted',status:'pending',requestId:'private-canary'},{code:'submitted',status:'accepted',requestId:id},{code:'unknown'}]){
  const state=interestFormResult(emptyInterestForm,form(),result);assert.equal(state.status,'unconfirmed');assert.equal(state.note,'Hello pilot');assert.ok(!JSON.stringify(state).includes('private-canary'));
 }
 const oversized=form();oversized.set('introductory_note','😀'.repeat(501));assert.equal([...interestFormResult(emptyInterestForm,oversized,{code:'too_large'}).note].length,500);
});
test('closed, unavailable, access and validation outcomes remain distinct with fixed feedback',()=>{
 for(const [code,want] of [['request_closed','closed'],['flight_unavailable','flight_unavailable'],['profile_required','profile_required'],['unauthenticated','denied'],['forbidden','denied'],['invalid_input','editing'],['too_large','editing']] as const)assert.equal(interestFormResult(emptyInterestForm,form(),{code}).status,want);
});
