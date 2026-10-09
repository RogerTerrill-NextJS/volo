import assert from 'node:assert/strict';
import {test} from 'node:test';
import {listAdminInvitations,createInvitationQueryPorts,type InvitationQueryPorts} from '../lib/auth/invitation-admin-query.ts';
import type {AccessResult} from '../lib/auth/access.ts';

const id='30000000-0000-4000-8000-000000000001';
const admin:AccessResult={status:'authorized',member:{userId:'10000000-0000-4000-8000-000000000001',role:'admin'}};
const row={id,version:2,recipient_email:'person@example.invalid',status:'issued',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-02T00:00:00Z',invitation_send_attempts:[{invitation_version:2,outcome:'accepted',reconciled_outcome:null}]};
function ports(rows:unknown=[row],access:()=>Promise<AccessResult>=async()=>admin):InvitationQueryPorts{return {access,readRows:async()=>rows};}

test('only a current active admin can read and retain invitation results',async()=>{
 for(const access of [{status:'unauthenticated'},{status:'forbidden'},{status:'unavailable'},{status:'authorized',member:{userId:admin.member.userId,role:'member'}}] as AccessResult[]){
  let reads=0;const result=await listAdminInvitations({access:async()=>access,readRows:async()=>{reads++;return [row];}});
  assert.equal(reads,0);assert.equal(result.status,access.status==='authorized'?'forbidden':access.status);
 }
 for(const after of [{status:'forbidden'},{status:'unavailable'},{status:'authorized',member:{userId:'10000000-0000-4000-8000-000000000002',role:'admin'}}] as AccessResult[]){
  let checks=0;const result=await listAdminInvitations(ports([row],async()=>++checks===1?admin:after));
  assert.equal(checks,2);assert.notEqual(result.status,'authorized');assert.ok(!JSON.stringify(result).includes(row.recipient_email));
 }
 let checks=0;assert.deepEqual(await listAdminInvitations(ports([row],async()=>{if(++checks===2)throw new Error('secret-canary');return admin;})),{status:'unavailable'});
});

test('lifecycle and current-generation send facts stay independent',async()=>{
 for(const [status,label] of [['pending_issuance','Pending'],['issued','Awaiting signup'],['setup_verified','Setup in progress'],['password_established','Setup in progress'],['redeemed','Redeemed'],['revoked','Revoked'],['superseded','Superseded']]){
  for(const [outcome,resolution,send] of [['started',null,'Needs review'],['unknown',null,'Needs review'],['accepted',null,'Accepted for sending'],['rejected',null,'Send failed'],['unknown','accepted','Accepted for sending'],['started','rejected','Send failed']]){
   const result=await listAdminInvitations(ports([{...row,status,invitation_send_attempts:[{invitation_version:2,outcome,reconciled_outcome:resolution}]}]));
   assert.equal(result.status,'authorized');if(result.status!=='authorized')return;
   assert.equal(result.rows[0].invitationStatus,label);assert.equal(result.rows[0].sendStatus,send);
  }
 }
 for(const attempts of [[],[{invitation_version:1,outcome:'accepted',reconciled_outcome:null}]]){
  const result=await listAdminInvitations(ports([{...row,invitation_send_attempts:attempts}]));assert.equal(result.status,'authorized');if(result.status==='authorized')assert.equal(result.rows[0].sendStatus,'Not sent');
 }
});

test('bounded DTO excludes authority fields and distinguishes empty from failure',async()=>{
 assert.deepEqual(await listAdminInvitations(ports([])),{status:'authorized',rows:[],hasMore:false});
 const result=await listAdminInvitations(ports(Array.from({length:51},(_,i)=>({...row,id:`30000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,auth_user_id:'secret-canary',setup_authorization_id:'secret-canary'}))));
 assert.equal(result.status,'authorized');if(result.status!=='authorized')return;
 assert.equal(result.rows.length,50);assert.equal(result.hasMore,true);assert.deepEqual(Object.keys(result.rows[0]).sort(),['email','id','invitationStatus','sendStatus','updatedAt','version']);assert.ok(!JSON.stringify(result).includes('secret-canary'));
 for(const rows of [null,{},[null],[{...row,version:0}],[{...row,status:'future'}],[{...row,updated_at:'invalid'}],[{...row,invitation_send_attempts:[{invitation_version:3,outcome:'accepted',reconciled_outcome:null}]}],[{...row,invitation_send_attempts:[{},{}]}]])assert.deepEqual(await listAdminInvitations(ports(rows)),{status:'unavailable'});
 assert.deepEqual(await listAdminInvitations({...ports(),readRows:async()=>{throw new Error('secret-canary');}}),{status:'unavailable'});
});

test('SDK query reads one bounded minimal relation snapshot',async()=>{
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='sb_publishable_ci_fixture';process.env.SUPABASE_SECRET_KEY='sb_secret_query_fixture';
 const original=globalThis.fetch;let reads=0,broken=false;
 globalThis.fetch=async(input,init)=>{
  reads++;const url=new URL(String(input));assert.equal(url.origin,'https://example.supabase.co');assert.equal(url.pathname,'/rest/v1/invitations');assert.equal(init?.cache,'no-store');assert.equal(init?.redirect,'error');
  assert.equal(url.searchParams.get('select'),'id,version,recipient_email,status,created_at,updated_at,invitation_send_attempts(invitation_version,outcome,reconciled_outcome)');
  assert.equal(url.searchParams.get('order'),'created_at.desc,id.desc');assert.equal(url.searchParams.get('limit'),'51');assert.equal(url.searchParams.get('invitation_send_attempts.order'),'invitation_version.desc');assert.equal(url.searchParams.get('invitation_send_attempts.limit'),'1');
  return broken?Response.json({message:'secret-canary'},{status:503}):Response.json([row]);
 };
 try{
  const p=createInvitationQueryPorts();p.access=async()=>admin;
  const result=await listAdminInvitations(p);assert.equal(result.status,'authorized');assert.equal(reads,1);
  broken=true;assert.deepEqual(await listAdminInvitations(p),{status:'unavailable'});assert.equal(reads,2);
 }finally{globalThis.fetch=original;delete process.env.SUPABASE_SECRET_KEY;}
});
