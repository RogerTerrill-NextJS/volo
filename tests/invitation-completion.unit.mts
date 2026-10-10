import assert from 'node:assert/strict';
import {test} from 'node:test';
import {completeInvitedAccount,type CompletionPorts} from '../lib/auth/invitation-completion.ts';
const identity={subject:'22000000-0000-4000-8000-000000000124',email:'Member@example.invalid',sessionId:'55000000-0000-4000-8000-000000000124'};
const input={identity,setupDigest:'c'.repeat(64),origin:'https://preview.invalid',password:'Password_canary124'};
const context={invitationId:'33000000-0000-4000-8000-000000000124',version:1,authorizationId:'66000000-0000-4000-8000-000000000124'};
function fixture(){
 const calls:string[]=[],operationId='77000000-0000-4000-8000-000000000124';
 const bound={...context,identity,setupDigest:input.setupDigest,origin:input.origin};
 const ports:CompletionPorts={newOperationId:()=>operationId,store:{
  async beginCompletion(i){calls.push('begin');assert.deepEqual(i,{identity,setupDigest:input.setupDigest,origin:input.origin,operationId});return {code:'reserved',...context};},
  async recordPassword(i){calls.push('record');assert.deepEqual(i,{...bound,operationId});return {code:'recorded'};},
  async releasePassword(i){calls.push('release');assert.deepEqual(i,{...bound,operationId});return {code:'released'};},
  async redeem(i){calls.push('redeem');assert.deepEqual(i,bound);return {code:'redeemed'};},
 },async eligible(i){calls.push('eligible');assert.deepEqual(i,{invitationId:context.invitationId,expectedVersion:1,verifiedSubject:identity.subject,verifiedEmail:identity.email});return 'eligible';},
 async setPassword(p){calls.push('password');assert.equal(p,input.password);return {code:'updated'};},
 async verifyIdentity(){calls.push('identity');return {code:'verified',identity};},
 async access(){calls.push('access');return {status:'authorized',member:{userId:identity.subject,role:'member'}};}};
 return {calls,ports};
}
test('fresh completion orders verified password evidence before redemption and current access',async()=>{
 const f=fixture();assert.deepEqual(await completeInvitedAccount(input,f.ports),{code:'completed'});assert.deepEqual(f.calls,['begin','eligible','password','identity','record','redeem','access']);
});
test('password evidence and redeemed history resume without password writes',async()=>{
 for(const code of ['password_established','redeemed'] as const){const f=fixture();f.ports.store.beginCompletion=async()=>({code,...context});f.ports.store.redeem=async()=>{f.calls.push('redeem');return {code:'already_redeemed'};};assert.equal((await completeInvitedAccount(input,f.ports)).code,'completed');assert.deepEqual(f.calls,code==='redeemed'?['redeem','access']:['eligible','redeem','access']);}
});
test('denied, busy and unavailable begin never call password or redemption',async()=>{
 for(const [code,want] of [['denied','access_denied'],['busy','retry_later'],['renew_required','renew_required'],['unavailable','retry_later']] as const){const f=fixture();f.ports.store.beginCompletion=async()=>({code});assert.deepEqual(await completeInvitedAccount(input,f.ports),{code:want});assert.deepEqual(f.calls,[]);}
});
test('known password rejection releases while unknown outcomes remain reserved',async()=>{
 for(const [code,want,tail] of [['rejected','password_rejected',['release']],['unknown','renew_required',[]]] as const){const f=fixture();f.ports.setPassword=async()=>{f.calls.push('password');return {code};};assert.equal((await completeInvitedAccount(input,f.ports)).code,want);assert.deepEqual(f.calls,['begin','eligible','password',...tail]);}
});
test('lost evidence response reconciles committed evidence without a second password write',async()=>{
 const f=fixture();f.ports.store.recordPassword=async()=>{f.calls.push('record');return {code:'unavailable'};};f.ports.store.releasePassword=async()=>{f.calls.push('release');return {code:'recorded'};};assert.equal((await completeInvitedAccount(input,f.ports)).code,'completed');assert.deepEqual(f.calls,['begin','eligible','password','identity','record','release','redeem','access']);
});
test('failed evidence safely releases only confirmed ownership and otherwise requires renewal',async()=>{
 for(const [code,want] of [['released','retry_later'],['denied','renew_required'],['unavailable','renew_required']] as const){const f=fixture();f.ports.store.recordPassword=async()=>({code:'unavailable'});f.ports.store.releasePassword=async()=>({code});assert.equal((await completeInvitedAccount(input,f.ports)).code,want);assert.ok(!f.calls.includes('redeem'));}
});
test('stale authority or changed post-write identity never records or redeems',async()=>{
 const f=fixture();f.ports.store.recordPassword=async()=>({code:'denied'});assert.equal((await completeInvitedAccount(input,f.ports)).code,'access_denied');assert.ok(!f.calls.includes('redeem'));
 for(const changed of [{subject:'other'},{email:'other@example.invalid'},{sessionId:'other'}]){const g=fixture();g.ports.verifyIdentity=async()=>({code:'verified',identity:{...identity,...changed}});assert.equal((await completeInvitedAccount(input,g.ports)).code,'renew_required');assert.ok(!g.calls.includes('record')&&!g.calls.includes('redeem')&&!g.calls.includes('release'));}
});
test('no current access follows failed redemption or disabled and mismatched membership',async()=>{
 for(const [code,want] of [['unavailable','retry_later'],['denied','access_denied'],['conflict','access_denied']] as const){const f=fixture();f.ports.store.redeem=async()=>({code});assert.equal((await completeInvitedAccount(input,f.ports)).code,want);assert.ok(!f.calls.includes('access'));}
 for(const status of ['forbidden','unauthenticated','unavailable'] as const){const f=fixture();f.ports.access=async()=>({status});assert.equal((await completeInvitedAccount(input,f.ports)).code,status==='unavailable'?'retry_later':'access_denied');}
 const f=fixture();f.ports.access=async()=>({status:'authorized',member:{userId:'other',role:'admin'}});assert.equal((await completeInvitedAccount(input,f.ports)).code,'access_denied');
});
test('eligibility failure before password releases safely without changing Auth',async()=>{
 for(const [result,want] of [['not_eligible','access_denied'],['unavailable','retry_later']] as const){const f=fixture();f.ports.eligible=async()=>result;assert.equal((await completeInvitedAccount(input,f.ports)).code,want);assert.deepEqual(f.calls,['begin','release']);}
});
