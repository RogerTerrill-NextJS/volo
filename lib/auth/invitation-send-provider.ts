import 'server-only';
import {createClient} from '@supabase/supabase-js';
import type {Database} from '../supabase/database.types';
import {getSupabasePrivilegedConfig} from '../supabase/privileged-config.mjs';
import {invitationEmail,invitationEmailKey,invitationUuid,type InitialSendPorts,type ProviderResult,type Reservation} from './invitation-send.ts';

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
 return new URL('/auth/confirm',url).href;
}

/** Lazy server adapter: constructing the mutation policy does not read a key. */
export function createInitialSendPorts():InitialSendPorts {
 const client=()=>{
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
 };
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
  async currentAdmin(requesterId){
   const {getAccess}=await import('./access.ts');const access=await getAccess();
   if(access.status==='unavailable')throw unavailable();
   return access.status==='authorized'&&access.member.userId===requesterId&&access.member.role==='admin';
  },
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
