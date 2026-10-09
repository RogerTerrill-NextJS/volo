import 'server-only';
import {createClient} from '@supabase/supabase-js';
import type {Database} from '../supabase/database.types';
import {getSupabasePrivilegedConfig} from '../supabase/privileged-config.mjs';
import {invitationEmail,invitationEmailKey,invitationUuid,type InitialSendPorts,type ProviderResult,type Reservation} from './invitation-send.ts';
import type {ResendPorts,ResendReservation,SubjectInspection,SnapshotQuery,SendSnapshot,ReconciliationPorts} from './invitation-resend.ts';

const unavailable=()=>new Error('Invitation service unavailable.');
function object(value:unknown):Record<string,unknown> {
 if(!value||typeof value!=='object'||Array.isArray(value))throw unavailable();
 return value as Record<string,unknown>;
}
function code<T extends string>(value:unknown,allowed:readonly T[]):T {
 const result=object(value).code;
 if(typeof result!=='string'||!allowed.includes(result as T))throw unavailable();
 return result as T;
}
function confirmUrl():string {
 const origin=process.env.VOLO_MUTATION_ORIGIN??'';const url=new URL(origin);
 if(url.origin!==origin||url.username||url.password||!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw unavailable();
 const callback=new URL('/auth/confirm',url);callback.searchParams.set('flow','invitation');return callback.href;
}

function client(){
  const {url,secretKey}=getSupabasePrivilegedConfig();
  return createClient<Database>(url,secretKey,{
   auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
   global:{fetch:async(input,init)=>{
    const timeout=new AbortController();const timer=setTimeout(()=>timeout.abort(),5000);
    try {
     const signal=init?.signal?AbortSignal.any([init.signal,timeout.signal]):timeout.signal;
     const response=await fetch(input,{...init,signal,cache:'no-store',redirect:'error'});
     const body=await response.text();if(signal.aborted)throw unavailable();
     return new Response(body,{status:response.status,headers:response.headers});
    }finally {clearTimeout(timer);timeout.abort();}
   }},
  });
}
async function currentAdmin(requesterId:string){
 const {getAccess}=await import('./access.ts');const access=await getAccess();
 if(access.status==='unavailable')throw unavailable();
 return access.status==='authorized'&&access.member.userId===requesterId&&access.member.role==='admin';
}
/** Lazy server adapter: constructing the mutation policy does not read a key. */
export function createInitialSendPorts():InitialSendPorts {
 const provider=async(kind:'create'|'invite',email:string,id?:string):Promise<ProviderResult>=>{
  try {
   const admin=client().auth.admin;
   const result=kind==='create'?await admin.createUser({id,email,email_confirm:false}):await admin.inviteUserByEmail(email,{redirectTo:confirmUrl()});
   if(result.error){
    // Duplicate creation is known to have sent no email. Invite failures are
    // deliberately uncertain until VOLO-149 has explicit reconciliation proof.
    if(kind==='create' && [409,422].includes(result.error.status??0) && ['email_exists','user_already_exists'].includes(result.error.code??''))return {code:'rejected',errorCode:'identity_conflict'};
    return {code:'unknown',errorCode:(result.error.status??0)>=500?'provider_unavailable':'unknown'};
   }
   const user=result.data.user;
   if(!user||!invitationUuid.test(user.id)||!invitationEmail(user.email))return {code:'unknown',errorCode:'identity_conflict'};
   return {code:'accepted',identity:{subjectId:user.id,email:user.email!}};
  }catch{return {code:'unknown',errorCode:'unknown'};}
 };
 return {
  currentAdmin,
  async reserve(command):Promise<Reservation>{
   const result=await client().rpc('reserve_invitation_send',{p_operation_id:command.operationId,p_recipient_email:command.recipientEmail,p_requester_id:command.requesterId}).retry(false);
   if(result.error)throw unavailable();
   const value=object(result.data);const status=code(value,['reserved','denied','conflict','invalid_input'] as const);
   if(status!=='reserved')return {code:status};
   if(typeof value.invitation_id!=='string'||!invitationUuid.test(value.invitation_id)||value.attempt_id!==command.operationId||
    !Number.isSafeInteger(value.version)||(value.version as number)<1||typeof value.fresh!=='boolean'||
    typeof value.recipient_email!=='string'||invitationEmail(value.recipient_email)!==value.recipient_email||invitationEmailKey(value.recipient_email)!==invitationEmailKey(command.recipientEmail)||
    !['started','accepted','rejected','unknown'].includes(String(value.outcome))||(value.fresh&&(value.version!==1||value.outcome!=='started')))throw unavailable();
   return {code:'reserved',invitationId:value.invitation_id,attemptId:command.operationId,version:value.version as number,recipientEmail:value.recipient_email,fresh:value.fresh,outcome:value.outcome as 'started'|'accepted'|'rejected'|'unknown'};
  },
  createSubject:(id,email)=>provider('create',email,id),
  async bind(r,requesterId,subjectId){
   const result=await client().rpc('bind_invitation_send_subject',{p_attempt_id:r.attemptId,p_expected_version:r.version,p_requester_id:requesterId,p_subject_id:subjectId}).retry(false);
   if(result.error)throw unavailable();return code(result.data,['bound','denied','stale','conflict'] as const);
  },
  invite:email=>provider('invite',email),
  async record(r,outcome,subjectId,errorCode){
   // The CLI generator models SQL function arguments as non-null even though
   // PostgreSQL accepts null here. Preserve explicit SQL nulls at this boundary.
   const result=await client().rpc('record_invitation_send_outcome',{p_attempt_id:r.attemptId,p_expected_version:r.version,p_outcome:outcome,p_subject_id:subjectId!,p_error_code:errorCode!}).retry(false);
   if(result.error)throw unavailable();return code(result.data,['recorded','stale','conflict'] as const);
  },
 };
}

async function inspectSubject(subjectId:string):Promise<SubjectInspection> {
 try {
  const result=await client().auth.admin.getUserById(subjectId);
  if(result.error)return {code:result.error.status===404?'missing':'unavailable'};
  const user=result.data.user;
  if(!user||user.id!==subjectId||!invitationUuid.test(user.id)||!invitationEmail(user.email))return {code:'unavailable'};
  return {code:'found',subjectId:user.id,email:user.email!,confirmed:Boolean(user.email_confirmed_at),banned:Boolean(user.banned_until)};
 }catch{return {code:'unavailable'};}
}

export function createResendPorts():ResendPorts {
 const initial=createInitialSendPorts();
 return {
  currentAdmin,inspectSubject,record:initial.record,
  async reserve(command){
   const result=await client().rpc('reserve_invitation_resend',{p_operation_id:command.operationId,p_invitation_id:command.invitationId,p_expected_version:command.expectedVersion,p_requester_id:command.requesterId}).retry(false);
   if(result.error)throw unavailable();
   const value=object(result.data);const status=code(value,['reserved','denied','conflict','stale','pending_reconciliation','invalid_input'] as const);
   if(status!=='reserved')return {code:status};
   if(value.invitation_id!==command.invitationId||value.attempt_id!==command.operationId||value.version!==command.expectedVersion+1
    ||typeof value.subject_id!=='string'||!invitationUuid.test(value.subject_id)||typeof value.fresh!=='boolean'
    ||typeof value.recipient_email!=='string'||invitationEmail(value.recipient_email)!==value.recipient_email
    ||!['started','accepted','rejected','unknown'].includes(String(value.outcome))
    ||(value.resolution!==null&&!['accepted','rejected'].includes(String(value.resolution)))
    ||(value.fresh&&(value.outcome!=='started'||value.resolution!==null)))throw unavailable();
   return {code:'reserved',invitationId:command.invitationId,attemptId:command.operationId,version:value.version as number,
    subjectId:value.subject_id,recipientEmail:value.recipient_email,fresh:value.fresh,outcome:value.outcome as ResendReservation['outcome'],resolution:value.resolution as ResendReservation['resolution']};
  },
  async prepareProof(r,requesterId,digest,transport){
   const result=await client().rpc('prepare_invitation_send_proof',{p_attempt_id:r.attemptId,p_expected_version:r.version,p_requester_id:requesterId,p_subject_id:r.subjectId,p_secret_digest:digest,p_transport:transport}).retry(false);
   if(result.error)throw unavailable();return code(result.data,['prepared','denied','stale','conflict'] as const);
  },
  async send(r,transport,secret,canSend):Promise<ProviderResult>{
   try {
    if(!/^[A-Za-z0-9_-]{43}$/.test(secret))return {code:'unknown',errorCode:'identity_conflict'};
    const before=await inspectSubject(r.subjectId);
    const matches=(user:SubjectInspection)=>user.code==='found'&&!user.banned&&user.subjectId===r.subjectId&&invitationEmailKey(user.email)===invitationEmailKey(r.recipientEmail);
    if(!matches(before)||before.code!=='found'||before.confirmed!==(transport==='recovery'))return {code:'unknown',errorCode:'identity_conflict'};
    const redirect=new URL(confirmUrl());redirect.searchParams.set('resume',secret);
    if(!await canSend())return {code:'rejected',errorCode:'provider_rejected'};
    if(transport==='invite'){
     const result=await client().auth.admin.inviteUserByEmail(r.recipientEmail,{redirectTo:redirect.href});
     if(result.error)return {code:'unknown',errorCode:(result.error.status??0)>=500?'provider_unavailable':'unknown'};
     if(result.data.user?.id!==r.subjectId||invitationEmailKey(result.data.user?.email)!==invitationEmailKey(r.recipientEmail))return {code:'unknown',errorCode:'identity_conflict'};
    }else{
     const result=await client().auth.resetPasswordForEmail(r.recipientEmail,{redirectTo:redirect.href});
     if(result.error)return {code:'unknown',errorCode:(result.error.status??0)>=500?'provider_unavailable':'unknown'};
    }
    const after=await inspectSubject(r.subjectId);
    return matches(after)&&after.code==='found'?{code:'accepted',identity:{subjectId:after.subjectId,email:after.email}}:{code:'unknown',errorCode:'identity_conflict'};
   }catch{return {code:'unknown',errorCode:'unknown'};}
  },
 };
}

async function load(query:SnapshotQuery):Promise<SendSnapshot|null> {
 const db=client();let request=db.from('invitation_send_attempts').select('id,invitation_id,invitation_version,kind,outcome,reconciled_outcome');
 if(query.attemptId)request=request.eq('id',query.attemptId);
 else if(query.invitationId)request=request.eq('invitation_id',query.invitationId).eq('invitation_version',query.expectedVersion);
 else throw unavailable();
 const attempts=await request.retry(false);if(attempts.error||!attempts.data||attempts.data.length>1)throw unavailable();
 if(!attempts.data.length)return null;const attempt=attempts.data[0];
 const invitations=await db.from('invitations').select('id,version,status,auth_user_id,recipient_email').eq('id',attempt.invitation_id).retry(false);
 if(invitations.error||!invitations.data||invitations.data.length!==1)throw unavailable();const invitation=invitations.data[0];
 if(!invitationUuid.test(attempt.id)||!invitationUuid.test(invitation.id)||!Number.isSafeInteger(attempt.invitation_version)
  ||!Number.isSafeInteger(invitation.version)||attempt.invitation_version<1||invitation.version<1
  ||(invitation.auth_user_id!==null&&!invitationUuid.test(invitation.auth_user_id))||!invitationEmail(invitation.recipient_email)
  ||!['initial','resend'].includes(attempt.kind)||!['started','accepted','rejected','unknown'].includes(attempt.outcome)
  ||(attempt.reconciled_outcome!==null&&!['accepted','rejected'].includes(attempt.reconciled_outcome))
  ||!['pending_issuance','issued','setup_verified','password_established','redeemed','revoked','superseded'].includes(invitation.status))throw unavailable();
 return {invitationId:invitation.id,attemptId:attempt.id,version:attempt.invitation_version,currentVersion:invitation.version,
  subjectId:invitation.auth_user_id,email:invitation.recipient_email,status:invitation.status,kind:attempt.kind,outcome:attempt.outcome,resolution:attempt.reconciled_outcome};
}
export function createSendInspectionPorts(){return {currentAdmin,load};}
/** No request parser exposes this observed-outcome capability. */
export function createSendReconciliationPorts():ReconciliationPorts {
 return {currentAdmin,load,async reconcile(command,observation){
  const snapshot=await load(command);if(!snapshot)throw unavailable();
  const result=await client().rpc('reconcile_invitation_send',{p_attempt_id:command.attemptId,p_expected_version:command.expectedVersion,p_requester_id:command.requesterId,
   p_outcome:observation.outcome,p_subject_id:(observation.outcome==='accepted'?observation.identity.subjectId:snapshot.subjectId)!}).retry(false);
  if(result.error)throw unavailable();return code(result.data,['reconciled','denied','stale','conflict'] as const);
 }};
}
