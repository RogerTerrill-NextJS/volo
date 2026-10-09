import assert from 'node:assert/strict';
import {test} from 'node:test';
import {executeInitialInvitation,type InitialSendPorts,type ReservedSend} from '../lib/auth/invitation-send.ts';
import {createInitialSendPorts} from '../lib/auth/invitation-send-provider.ts';
import {invitationIssuancePolicy} from '../lib/auth/invitation-issuance.ts';
import {createServer} from 'node:http';
import {once} from 'node:events';

const operationId='20000000-0000-4000-8000-000000000001';
const requesterId='10000000-0000-4000-8000-000000000001';
const command={operationId,requesterId,recipientEmail:'Person+tag@Example.invalid'};
const reserved:ReservedSend={code:'reserved',invitationId:'30000000-0000-4000-8000-000000000001',attemptId:operationId,version:1,recipientEmail:command.recipientEmail,fresh:true,outcome:'started'};
function harness(changes:Partial<InitialSendPorts>={}) {
 const trace:string[]=[];const observations:unknown[]=[];
 const ports:InitialSendPorts={
  async currentAdmin(id){trace.push('admin');assert.equal(id,requesterId);return true;},
  async reserve(input){trace.push('reserve');assert.deepEqual(input,command);return reserved;},
  async createSubject(id,email){trace.push('create');assert.equal(id,operationId);assert.equal(email,command.recipientEmail);return {code:'accepted',identity:{subjectId:id,email:email.toLowerCase()}};},
  async bind(r,id,subject){trace.push('bind');assert.equal(r.attemptId,operationId);assert.equal(id,requesterId);assert.equal(subject,operationId);return 'bound';},
  async invite(email){trace.push('invite');assert.equal(email,command.recipientEmail);return {code:'accepted',identity:{subjectId:operationId,email:email.toLowerCase()}};},
  async record(r,outcome,subject,error){trace.push('record');observations.push({r,outcome,subject,error});return 'recorded';},
  ...changes,
 };
 return {trace,observations,run:()=>executeInitialInvitation(command,ports)};
}
test('initial send binds the newly created subject before inviting and records acceptance',async()=>{
 const h=harness();assert.deepEqual(await h.run(),{code:'accepted'});
 assert.deepEqual(h.trace,['admin','reserve','admin','create','bind','admin','invite','record']);
 assert.equal((h.observations[0] as {outcome:string}).outcome,'accepted');
});
test('denial and durable replay cannot execute provider writes',async()=>{
 let h=harness({currentAdmin:async()=>false});assert.deepEqual(await h.run(),{code:'rejected'});assert.equal(h.trace.length,0);
 for(const [outcome,want] of [['started','pending_reconciliation'],['unknown','pending_reconciliation'],['accepted','accepted'],['rejected','rejected']] as const){
  h=harness({reserve:async()=>({...reserved,fresh:false,outcome})});
  assert.deepEqual(await h.run(),{code:want});assert.deepEqual(h.trace,['admin']);
 }
 h=harness({reserve:async()=>({code:'conflict'})});assert.deepEqual(await h.run(),{code:'conflict'});assert.deepEqual(h.trace,['admin']);
});
test('admin revocation or lookup failure after reservation stops before account creation',async()=>{
 for(const unavailable of [false,true]){
  let active=true;
  const h=harness({reserve:async()=>{active=false;return reserved;},currentAdmin:async()=>{if(!active&&unavailable)throw new Error('private-canary');return active;}});
  assert.deepEqual(await h.run(),{code:unavailable?'pending_reconciliation':'rejected'});
  assert.ok(!h.trace.includes('create'),'must recheck admin before creating a provider identity');
  assert.equal((h.observations[0] as {outcome:string}).outcome,unavailable?'unknown':'rejected');
 }
});
test('provider uncertainty and pre-send failures never retry or invite a discovered identity',async()=>{
 for(const [changes,want,observed] of [
  [{createSubject:async()=>({code:'rejected',errorCode:'identity_conflict'})},'rejected','rejected'],
  [{createSubject:async()=>({code:'unknown',errorCode:'timeout'})},'pending_reconciliation','unknown'],
  [{createSubject:async()=>{throw new Error('private-canary');}},'pending_reconciliation','unknown'],
  [{createSubject:async()=>({code:'accepted',identity:{subjectId:requesterId,email:command.recipientEmail}})},'pending_reconciliation','unknown'],
  [{bind:async()=>'conflict'},'rejected','rejected'],
 ] as [Partial<InitialSendPorts>,string,string][]){
  const h=harness(changes);assert.deepEqual(await h.run(),{code:want});assert.ok(!h.trace.includes('invite'));
  assert.equal((h.observations[0] as {outcome:string}).outcome,observed);
 }
 let checks=0;const h=harness({currentAdmin:async()=>++checks<3});
 assert.deepEqual(await h.run(),{code:'rejected'});assert.ok(!h.trace.includes('invite'));
});
test('mismatched sends and lost finalization require reconciliation',async()=>{
 for(const changes of [
  {invite:async()=>({code:'accepted',identity:{subjectId:requesterId,email:command.recipientEmail}})},
  {invite:async()=>({code:'accepted',identity:{subjectId:operationId,email:'other@example.invalid'}})},
  {invite:async()=>({code:'unknown',errorCode:'provider_unavailable'})},
  {record:async()=>{throw new Error('private-canary');}},
  {record:async()=>'stale'},
 ] as Partial<InitialSendPorts>[]){const h=harness(changes);assert.deepEqual(await h.run(),{code:'pending_reconciliation'});}
 const h=harness({reserve:async()=>{throw new Error('private-canary');}});assert.deepEqual(await h.run(),{code:'unavailable'});
});
test('issuance input accepts only a bounded specific email without caller authority',()=>{
 const policy=invitationIssuancePolicy();assert.deepEqual(policy.allowedRoles,['admin']);
 assert.deepEqual(policy.parse({email:' Person+tag@Example.invalid '}),{ok:true,value:{email:'Person+tag@Example.invalid'}});
 for(const raw of [null,[],{}, {email:'x@@example.invalid'}, {email:'café@example.invalid'}, {email:'a'.repeat(255)+'@b'},
  ...['role','requesterId','operationId','redirectTo'].map(key=>({email:'x@y.invalid',[key]:'untrusted'}))])assert.deepEqual(policy.parse(raw),{ok:false});
});
test('provider adapter emits exact creation and callback inputs and refuses malformed evidence',async()=>{
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='sb_publishable_ci_fixture';
 process.env.SUPABASE_SECRET_KEY='sb_secret_invitation_test_fixture';process.env.VOLO_MUTATION_ORIGIN='https://voloapp.netlify.app';
 const original=globalThis.fetch;let response:unknown;let status=200;const requests:{url:URL;body:Record<string,unknown>}[]=[];
 globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input));assert.equal(url.origin,'https://example.supabase.co');assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');
  assert.equal(new Headers(init?.headers).get('apikey'),'sb_secret_invitation_test_fixture');
  requests.push({url,body:JSON.parse(String(init?.body))});return Response.json(response,{status,headers:{"x-supabase-api-version":"2024-01-01"}});
 };
 try {
  const ports=createInitialSendPorts();response={id:operationId,email:command.recipientEmail};
  assert.equal((await ports.createSubject(operationId,command.recipientEmail)).code,'accepted');
  assert.deepEqual(requests.at(-1)?.body,{id:operationId,email:command.recipientEmail,email_confirm:false});
  assert.equal((await ports.invite(command.recipientEmail)).code,'accepted');
  assert.equal(requests.at(-1)?.url.searchParams.get('redirect_to'),'https://voloapp.netlify.app/auth/confirm?flow=invitation');
  status=422;response={code:'email_exists',msg:'private-canary'};
  assert.deepEqual(await ports.createSubject(operationId,command.recipientEmail),{code:'rejected',errorCode:'identity_conflict'});
  assert.equal((await ports.invite(command.recipientEmail)).code,'unknown');
  status=503;response={code:'email_exists'};assert.equal((await ports.createSubject(operationId,command.recipientEmail)).code,'unknown');
  status=200;
  for(const malformed of [null,{}, {code:'reserved'}, {code:'reserved',invitation_id:reserved.invitationId,attempt_id:operationId,version:Number.MAX_SAFE_INTEGER+1,recipient_email:command.recipientEmail,fresh:true,outcome:'started'}]){
   response=malformed;await assert.rejects(ports.reserve(command),/Invitation service unavailable/);
  }
  response={code:'reserved',invitation_id:reserved.invitationId,attempt_id:operationId,version:1,recipient_email:command.recipientEmail,fresh:true,outcome:'started'};
  assert.deepEqual(await ports.reserve(command),reserved);
  response={code:'recorded'};assert.equal(await ports.record(reserved,'unknown',null,'timeout'),'recorded');
  assert.equal(requests.at(-1)?.body.p_subject_id,null);assert.equal(requests.at(-1)?.body.p_error_code,'timeout');
  response={id:'bad',email:command.recipientEmail};assert.equal((await ports.createSubject(operationId,command.recipientEmail)).code,'unknown');
 }finally {globalThis.fetch=original;delete process.env.SUPABASE_SECRET_KEY;}
});
test('provider deadlines include response bodies and redirects never reach their target',async()=>{
 let mode='headers',calls=0;
 const server=createServer((_req,res)=>{calls++;if(mode==='headers')return;if(mode==='body'){res.writeHead(200,{'content-type':'application/json'});res.write('{');return;}res.writeHead(302,{location:'/leak'}).end();});
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');
 process.env.NEXT_PUBLIC_SUPABASE_URL=`http://127.0.0.1:${address.port}`;process.env.SUPABASE_SECRET_KEY='sb_secret_invitation_test_fixture';
 try {
  const ports=createInitialSendPorts();
  for(mode of ['headers','body']){const start=Date.now();assert.equal((await ports.invite(command.recipientEmail)).code,'unknown');assert.ok(Date.now()-start<6500);}
  mode='redirect';const before=calls;assert.equal((await ports.invite(command.recipientEmail)).code,'unknown');assert.equal(calls,before+1);
 }finally {delete process.env.SUPABASE_SECRET_KEY;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
