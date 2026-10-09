import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createConfirmationTransport,acceptInvitationConfirmation,type AcceptancePorts} from '../lib/auth/invitation-confirmation.ts';
import {createConfirmationStore} from '../lib/auth/invitation-confirmation-store.ts';
import {newConfirmationSecret,confirmationDigest,sealConfirmation,openConfirmation,type ConfirmationEnvelope} from '../lib/auth/invitation-confirmation-crypto.ts';
const origin='https://confirm.example.invalid',identity={subject:'22000000-0000-4000-8000-000000000001',email:'person@example.invalid',sessionId:'55000000-0000-4000-8000-000000000001'};
function fixture(){
 process.env.VOLO_CONFIRMATION_KEYS=JSON.stringify({active:'test',keys:{test:Buffer.alloc(32,2).toString('base64')}});
 let envelope:ConfirmationEnvelope|undefined,digest='',csrfDigest='',claimed=false,verifications=0,records=0,verifyCode='verified',recordCode='recorded';
 const ports:AcceptancePorts={store:{...createConfirmationStore(),async create(input){envelope=input.envelope;digest=input.lookupDigest;csrfDigest=input.csrfDigest;return {code:'created'};},async claim(input){if(claimed||input.lookupDigest!==digest||input.csrfDigest!==csrfDigest||input.origin!==origin||!envelope)return {code:'denied'};claimed=true;return {code:'claimed',envelope};},async resolveInvitation(){return {code:'eligible',invitationId:'33000000-0000-4000-8000-000000000001',version:1,attemptId:null};},async recordSetup(){records++;return recordCode==='recorded'?{code:'recorded',authorizationId:'66000000-0000-4000-8000-000000000001',expiresAt:new Date(Date.now()+1800000).toISOString()}:{code:'unavailable'};}},newSecret:newConfirmationSecret,seal:sealConfirmation,open:openConfirmation,digest:confirmationDigest,now:Date.now,async verify(){verifications++;return verifyCode==='verified'?{code:'verified',identity}:{code:'unavailable'};},async eligible(){return 'eligible';}};
 return {ports,counts:()=>({verifications,records}),failProvider:()=>{verifyCode='unavailable';},failRecord:()=>{recordCode='unavailable';},payload:(cookie:string)=>openConfirmation(envelope!,{origin,lookupDigest:confirmationDigest(cookie),expiresAt:envelope!.expiresAt})!};
}
test('explicit acceptance claims once and creates setup only after verified identity and eligibility',async()=>{
 const f=fixture(),created=await createConfirmationTransport({tokenHash:'provider_canary',type:'invite',resume:null,origin,previousCookie:null},f.ports);
 assert.equal(created.code,'created');if(created.code!=='created')return;
 assert.deepEqual(f.counts(),{verifications:0,records:0});const csrf=f.payload(created.cookie).csrf;
 assert.equal((await acceptInvitationConfirmation({cookie:created.cookie,csrf:newConfirmationSecret(),origin},f.ports)).code,'denied');assert.deepEqual(f.counts(),{verifications:0,records:0});
 const result=await acceptInvitationConfirmation({cookie:created.cookie,csrf,origin},f.ports);assert.equal(result.code,'accepted');assert.ok(!JSON.stringify(result).includes('provider_canary'));
 assert.equal((await acceptInvitationConfirmation({cookie:created.cookie,csrf,origin},f.ports)).code,'denied');assert.deepEqual(f.counts(),{verifications:1,records:1});
});
test('uncertain provider and later database failures never retry or deliver setup',async()=>{
 for(const failure of ['provider','record']){
  const f=fixture(),created=await createConfirmationTransport({tokenHash:'provider_canary',type:'invite',resume:null,origin,previousCookie:null},f.ports);assert.equal(created.code,'created');if(created.code!=='created')return;
  if(failure==='provider')f.failProvider();else f.failRecord();const input={cookie:created.cookie,csrf:f.payload(created.cookie).csrf,origin};
  assert.deepEqual(await acceptInvitationConfirmation(input,f.ports),{code:'unavailable'});assert.equal((await acceptInvitationConfirmation(input,f.ports)).code,'denied');assert.equal(f.counts().verifications,1);assert.equal(f.counts().records,failure==='provider'?0:1);
 }
});
