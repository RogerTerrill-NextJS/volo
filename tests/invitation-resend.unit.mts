import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import * as renewal from '../lib/auth/invitation-resend.ts';
import type {ResendPorts,ResendReservation,SendInspectionPorts,ReconciliationPorts} from '../lib/auth/invitation-resend.ts';
import * as policies from '../lib/auth/invitation-issuance.ts';
import * as provider from '../lib/auth/invitation-send-provider.ts';

const operationId='40000000-0000-4000-8000-000000000001';
const requesterId='10000000-0000-4000-8000-000000000001';
const invitationId='30000000-0000-4000-8000-000000000001';
const subjectId='20000000-0000-4000-8000-000000000001';
const email='Person+tag@example.invalid';
const command={operationId,requesterId,invitationId,expectedVersion:1};
const reserved:ResendReservation={code:'reserved',invitationId,attemptId:operationId,subjectId,version:2,recipientEmail:email,fresh:true,outcome:'started',resolution:null};
const subject={code:'found' as const,subjectId,email:email.toLowerCase(),confirmed:false,banned:false};
function harness(changes:Partial<ResendPorts>={}) {
 const trace:string[]=[];let storedDigest='',sentSecret='',sentTransport='';let sends=0;
 const ports:ResendPorts={
  async currentAdmin(id){assert.equal(id,requesterId);trace.push('admin');return true;},
  async reserve(input){assert.deepEqual(input,command);trace.push('reserve');return {...reserved};},
  async inspectSubject(id){assert.equal(id,subjectId);trace.push('inspect');return subject;},
  async prepareProof(r,id,digest,transport){assert.equal(r.attemptId,operationId);assert.equal(id,requesterId);trace.push('proof');storedDigest=digest;sentTransport=transport;return 'prepared';},
  async send(r,transport,secret){assert.equal(r.subjectId,subjectId);trace.push('send');sends++;sentSecret=secret;assert.equal(transport,sentTransport);return {code:'accepted',identity:{subjectId,email}};},
  async record(r,outcome,id,error){assert.equal(r.version,2);assert.equal(id,subjectId);assert.equal(error,null);assert.equal(outcome,'accepted');trace.push('record');return 'recorded';},
  ...changes,
 };
 return {ports,trace,run:()=>renewal.executeInvitationResend(command,ports),observed:()=>({storedDigest,sentSecret,sentTransport,sends})};
}
test('renewal commits a single-use digest before the chosen provider transport',async()=>{
 for(const confirmed of [false,true]){
  const h=harness({inspectSubject:async()=>({...subject,confirmed})});
  const result=await h.run();assert.deepEqual(result,{code:'accepted'});
  const observed=h.observed();assert.equal(observed.sentTransport,confirmed?'recovery':'invite');
  assert.equal(Buffer.from(observed.sentSecret,'base64url').length,32);
  assert.equal(observed.storedDigest,createHash('sha256').update(observed.sentSecret).digest('hex'));
  assert.ok(h.trace.indexOf('proof')<h.trace.indexOf('send'));assert.equal(observed.sends,1);
  assert.ok(!JSON.stringify(result).includes(observed.sentSecret));
 }
});
test('durable replay, unresolved predecessors and stale input cannot send',async()=>{
 for(const outcome of ['started','unknown','accepted','rejected'] as const){
  const h=harness({reserve:async()=>({...reserved,fresh:false,outcome})});
  assert.deepEqual(await h.run(),{code:outcome==='started'||outcome==='unknown'?'pending_reconciliation':outcome});
  assert.equal(h.observed().sends,0);assert.ok(!h.trace.includes('proof'));
 }
 const h=harness({reserve:async()=>({...reserved,fresh:false,outcome:'unknown',resolution:'accepted'})});
 assert.deepEqual(await h.run(),{code:'accepted'});assert.equal(h.observed().sends,0);
 for(const code of ['pending_reconciliation','stale','denied','conflict'] as const){
  const h=harness({reserve:async()=>({code})});await h.run();assert.equal(h.observed().sends,0);
 }
});
test('proof failure, identity mismatch and admin loss stop before sending',async()=>{
 for(const changes of [
  {prepareProof:async()=>'stale'},
  {inspectSubject:async()=>({...subject,subjectId:requesterId})},
  {inspectSubject:async()=>({...subject,email:'wrong@example.invalid'})},
  {inspectSubject:async()=>({...subject,banned:true})},
  {inspectSubject:async()=>({code:'missing'})},
 ] as Partial<ResendPorts>[]){
  const h=harness({...changes,record:async()=>'recorded'});await h.run();assert.equal(h.observed().sends,0);
 }
 let checks=0;const h=harness({currentAdmin:async()=>++checks<3,record:async()=>'recorded'});
 assert.deepEqual(await h.run(),{code:'rejected'});assert.equal(h.observed().sends,0);
});
test('uncertain transport, confirmation change and lost finalization never retry',async()=>{
 for(const changes of [
  {send:async()=>({code:'unknown',errorCode:'timeout'})},
  {send:async()=>({code:'accepted',identity:{subjectId:requesterId,email}})},
  {send:async()=>{throw new Error('secret-canary');}},
  {record:async()=>{throw new Error('secret-canary');}},
  {record:async()=>'stale'},
 ] as Partial<ResendPorts>[]){const h=harness({...changes,record:changes.record??(async()=>'recorded')});assert.deepEqual(await h.run(),{code:'pending_reconciliation'});assert.ok(h.observed().sends<=1);}
});
test('renewal and inspection parsers reject caller authority and unsafe versions',()=>{
 for(const policy of [policies.invitationResendPolicy(),policies.invitationSendInspectionPolicy()]){
  assert.deepEqual(policy.allowedRoles,['admin']);assert.deepEqual(policy.parse({invitationId,expectedVersion:1}),{ok:true,value:{invitationId,expectedVersion:1}});
  for(const expectedVersion of [null,0,-1,1.5,Number.MAX_SAFE_INTEGER,'1'])assert.deepEqual(policy.parse({invitationId,expectedVersion}),{ok:false});
  assert.deepEqual(policy.parse(Object.assign(Object.create({invitationId,expectedVersion:1}),{foo:1,bar:2})),{ok:false});
  for(const key of ['email','subjectId','role','operationId','outcome','redirectTo'])assert.deepEqual(policy.parse({invitationId,expectedVersion:1,[key]:'untrusted'}),{ok:false});
 }
});
test('inspection cannot turn account existence or timestamps into a send receipt',async()=>{
 const ports:SendInspectionPorts={currentAdmin:async()=>true,load:async()=>({invitationId,attemptId:operationId,version:2,currentVersion:2,subjectId,email,status:'pending_issuance',kind:'resend',outcome:'unknown',resolution:null})};
 assert.deepEqual(await renewal.inspectInvitationSend({invitationId,expectedVersion:2,requesterId},ports),{code:'pending_reconciliation'});
});
test('trusted reconciliation is fenced to the exact observed operation and identity',async()=>{
 let resolutions=0;
 const ports:ReconciliationPorts={currentAdmin:async()=>true,load:async()=>({invitationId,attemptId:operationId,version:2,currentVersion:2,subjectId,email,status:'pending_issuance',kind:'resend',outcome:'unknown',resolution:null}),
  async reconcile(_command,observation){assert.equal(observation.outcome==='accepted'&&observation.identity.subjectId,subjectId);resolutions++;return 'reconciled';}};
 const input={attemptId:operationId,expectedVersion:2,requesterId};
 assert.deepEqual(await renewal.reconcileInvitationSend(input,{attemptId:operationId,version:2,outcome:'accepted',identity:{subjectId:requesterId,email}},ports),{code:'conflict'});
 assert.deepEqual(await renewal.reconcileInvitationSend(input,{attemptId:operationId,version:1,outcome:'accepted',identity:{subjectId,email}},ports),{code:'conflict'});
 assert.equal(resolutions,0);
 assert.deepEqual(await renewal.reconcileInvitationSend(input,{attemptId:operationId,version:2,outcome:'accepted',identity:{subjectId,email}},ports),{code:'accepted'});assert.equal(resolutions,1);
});
test('real provider adapter constrains recovery payload and refuses missing-account success',async()=>{
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='sb_publishable_ci_fixture';process.env.SUPABASE_SECRET_KEY='sb_secret_resend_fixture';process.env.VOLO_MUTATION_ORIGIN='https://voloapp.netlify.app';
 const original=globalThis.fetch;const requests:{url:URL;body:unknown}[]=[];let missing=false,confirmed=true,missingAfter=false;
 globalThis.fetch=async(input,init)=>{const url=new URL(String(input));assert.equal(url.origin,'https://example.supabase.co');assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');
  requests.push({url,body:init?.body?JSON.parse(String(init.body)):null});
  if(url.pathname.endsWith('/recover')){if(missingAfter)missing=true;return Response.json({});}
  return missing?Response.json({code:'user_not_found',msg:'secret-canary'},{status:404}):Response.json({id:subjectId,email,email_confirmed_at:confirmed?'2026-01-01T00:00:00Z':null,banned_until:null});};
 try {
  const ports=provider.createResendPorts();assert.equal((await ports.send(reserved,'recovery','a'.repeat(43))).code,'accepted');
  const request=requests.find(r=>r.url.pathname.endsWith('/recover'))!;assert.deepEqual(request.body,{email,code_challenge:null,code_challenge_method:null,gotrue_meta_security:{}});
  const redirect=new URL(request.url.searchParams.get('redirect_to')!);assert.equal(redirect.origin,'https://voloapp.netlify.app');assert.equal(redirect.pathname,'/auth/confirm');assert.equal(redirect.searchParams.get('resume'),'a'.repeat(43));
  confirmed=false;const sends=requests.filter(r=>r.url.pathname.endsWith('/recover')).length;assert.equal((await ports.send(reserved,'recovery','a'.repeat(43))).code,'unknown');assert.equal(requests.filter(r=>r.url.pathname.endsWith('/recover')).length,sends);
  confirmed=true;missingAfter=true;assert.equal((await ports.send(reserved,'recovery','a'.repeat(43))).code,'unknown');
  missing=true;assert.equal((await ports.send(reserved,'recovery','a'.repeat(43))).code,'unknown');
 }finally{globalThis.fetch=original;delete process.env.SUPABASE_SECRET_KEY;}
});

test('rejected resend reconciliation retains the bound subject at the SQL boundary',async()=>{
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='sb_publishable_ci_fixture';process.env.SUPABASE_SECRET_KEY='sb_secret_resend_fixture';
 const original=globalThis.fetch;let bound:unknown;
 globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input));
  if(url.pathname.endsWith('/reconcile_invitation_send')){bound=JSON.parse(String(init?.body)).p_subject_id;return Response.json({code:'reconciled'});}
  if(url.pathname.endsWith('/invitation_send_attempts'))return Response.json([{id:operationId,invitation_id:invitationId,invitation_version:2,kind:'resend',outcome:'unknown',reconciled_outcome:null}]);
  return Response.json([{id:invitationId,version:2,status:'pending_issuance',auth_user_id:subjectId,recipient_email:email}]);
 };
 try{await provider.createSendReconciliationPorts().reconcile({attemptId:operationId,expectedVersion:2,requesterId},{attemptId:operationId,version:2,outcome:'rejected',errorCode:'provider_rejected'});assert.equal(bound,subjectId);}
 finally{globalThis.fetch=original;delete process.env.SUPABASE_SECRET_KEY;}
});
