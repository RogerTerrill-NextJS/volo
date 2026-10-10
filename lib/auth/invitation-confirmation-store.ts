import 'server-only';
import {createClient} from '@supabase/supabase-js';
import type {Database} from '../supabase/database.types.ts';
import {getSupabasePrivilegedConfig} from '../supabase/privileged-config.mjs';
import {invitationEmail,invitationUuid} from './invitation-send.ts';
import type {ConfirmationEnvelope} from './invitation-confirmation-crypto.ts';
export type VerifiedConfirmation={subject:string;email:string;sessionId:string};
export type ConfirmationResolution={code:'eligible';invitationId:string;version:number;attemptId:string|null};
export type CompletionContext={invitationId:string;version:number;authorizationId:string;setupDigest:string;identity:VerifiedConfirmation;origin:string};
export type CompletionStart={setupDigest:string;identity:VerifiedConfirmation;origin:string;operationId:string};
export type CompletionBeginResult={code:'reserved'|'password_established'|'redeemed';invitationId:string;version:number;authorizationId:string}|{code:'busy'|'renew_required'|'denied'|'unavailable'};
type Failure={code:'denied'|'unavailable'};
type EnvelopeResult=Failure|{code:'found'|'claimed';envelope:ConfirmationEnvelope};
export type SetupResult=Failure|{code:'recorded';authorizationId:string;expiresAt:string};
export type SetupReadResult=Failure|{code:'authorized';invitationId:string;version:number;authorizationId:string;expiresAt:string};
export type RedemptionResult=Failure|{code:'redeemed'|'already_redeemed'|'conflict'};
type TransportInput={lookupDigest:string;origin:string};
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value as Record<string,unknown>;}
function date(value:unknown):string{if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw new Error();return new Date(value).toISOString();}
function service(){
 const {url,secretKey}=getSupabasePrivilegedConfig();
 return createClient<Database>(url,secretKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,init)=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
  try{const response=await fetch(input,{...init,signal:controller.signal,cache:'no-store',redirect:'error'});const body=await response.text();if(controller.signal.aborted)throw new Error();return new Response(body,{status:response.status,headers:response.headers});}
  finally{clearTimeout(timer);controller.abort();}
 }}});
}
type Functions=Database['public']['Functions'];
// The generator omits SQL argument nullability; current initial invitations
// intentionally have null attempt/resume/previous values, validated by the RPC.
async function rpc<K extends keyof Functions>(name:K,args:{[P in keyof Functions[K]['Args']]:Functions[K]['Args'][P]|null}):Promise<Record<string,unknown>>{
 const result=await service().rpc(name,args as Functions[K]['Args']).retry(false);if(result.error)throw new Error();return object(result.data);
}
function envelopeResult(raw:Record<string,unknown>):EnvelopeResult{
 if(raw.code==='denied')return {code:'denied'};if(raw.code!=='found'&&raw.code!=='claimed')throw new Error();
 const e=object(raw.envelope);
 if(typeof e.keyId!=='string'||!/^[A-Za-z0-9_-]{1,32}$/.test(e.keyId)||typeof e.nonce!=='string'||!/^[A-Za-z0-9_-]{16}$/.test(e.nonce)
  ||typeof e.tag!=='string'||!/^[A-Za-z0-9_-]{22}$/.test(e.tag)||typeof e.ciphertext!=='string'||!/^[A-Za-z0-9_-]{1,2048}$/.test(e.ciphertext))throw new Error();
 return {code:raw.code,envelope:{keyId:e.keyId,nonce:e.nonce,tag:e.tag,ciphertext:e.ciphertext,expiresAt:date(e.expiresAt)}};
}
function passwordArgs(input:CompletionContext&{operationId:string}){
 const i=input.identity;return {p_operation_id:input.operationId,p_invitation_id:input.invitationId,p_expected_version:input.version,p_setup_authorization_id:input.authorizationId,p_setup_digest:input.setupDigest,p_subject:i.subject,p_email:i.email,p_session_id:i.sessionId,p_origin:input.origin};
}
export function createConfirmationStore(){return {
 async beginCompletion(input:CompletionStart):Promise<CompletionBeginResult>{try{
  const i=input.identity,result=await rpc('begin_invitation_completion',{p_operation_id:input.operationId,p_setup_digest:input.setupDigest,p_subject:i.subject,p_email:i.email,p_session_id:i.sessionId,p_origin:input.origin});
  if(result.code==='busy'||result.code==='renew_required'||result.code==='denied')return {code:result.code};
  if(!['reserved','password_established','redeemed'].includes(String(result.code))||typeof result.invitationId!=='string'||!invitationUuid.test(result.invitationId)||typeof result.authorizationId!=='string'||!invitationUuid.test(result.authorizationId)||!Number.isSafeInteger(result.version)||(result.version as number)<1)throw new Error();
  return {code:result.code as 'reserved'|'password_established'|'redeemed',invitationId:result.invitationId,version:result.version as number,authorizationId:result.authorizationId};
 }catch{return {code:'unavailable'};}},
 async recordPassword(input:CompletionContext&{operationId:string}):Promise<Failure|{code:'recorded'}>{try{
  const result=await rpc('record_invitation_password',passwordArgs(input));if(result.code==='recorded'||result.code==='denied')return {code:result.code};throw new Error();
 }catch{return {code:'unavailable'};}},
 async releasePassword(input:CompletionContext&{operationId:string}):Promise<Failure|{code:'released'|'recorded'}>{try{
  const result=await rpc('release_invitation_password',passwordArgs(input));if(result.code==='released'||result.code==='recorded'||result.code==='denied')return {code:result.code};throw new Error();
 }catch{return {code:'unavailable'};}},
 // VOLO-124 supplies server-verified identity/authority after password evidence
 // is persisted. Completion reports history; current membership gates access.
 async redeem(input:{invitationId:string;version:number;authorizationId:string;setupDigest:string;identity:VerifiedConfirmation;origin:string}):Promise<RedemptionResult>{try{
  const i=input.identity,result=await rpc('redeem_invitation',{p_invitation_id:input.invitationId,p_expected_version:input.version,p_setup_authorization_id:input.authorizationId,p_setup_digest:input.setupDigest,p_subject:i.subject,p_email:i.email,p_session_id:i.sessionId,p_origin:input.origin});
  if(result.code==='redeemed'||result.code==='already_redeemed'||result.code==='conflict'||result.code==='denied')return {code:result.code};throw new Error();
 }catch{return {code:'unavailable'};}},
 async create(input:TransportInput&{csrfDigest:string;envelope:ConfirmationEnvelope;previousDigest:string|null}):Promise<{code:'created'|'limited'}|Failure>{try{
  const e=input.envelope,result=await rpc('create_invitation_confirmation_transport',{p_lookup_digest:input.lookupDigest,p_csrf_digest:input.csrfDigest,p_origin:input.origin,p_expires_at:e.expiresAt,p_key_id:e.keyId,p_nonce:e.nonce,p_ciphertext:e.ciphertext,p_tag:e.tag,p_previous_digest:input.previousDigest});
  if(result.code==='created'||result.code==='limited'||result.code==='denied')return {code:result.code};throw new Error();
 }catch{return {code:'unavailable'};}},
 async read(input:TransportInput):Promise<EnvelopeResult>{try{return envelopeResult(await rpc('read_invitation_confirmation_transport',{p_lookup_digest:input.lookupDigest,p_origin:input.origin}));}catch{return {code:'unavailable'};}},
 async claim(input:TransportInput&{csrfDigest:string}):Promise<EnvelopeResult>{try{return envelopeResult(await rpc('claim_invitation_confirmation_transport',{p_lookup_digest:input.lookupDigest,p_csrf_digest:input.csrfDigest,p_origin:input.origin}));}catch{return {code:'unavailable'};}},
 async resolveInvitation(input:{subject:string;email:string;resumeDigest:string|null;type:'invite'|'recovery'}):Promise<ConfirmationResolution|Failure>{try{
  const email=invitationEmail(input.email);if(!email||!invitationUuid.test(input.subject))return {code:'denied'};
  const result=await service().from('invitations').select('id,version,invitation_send_attempts(id,invitation_version,kind,outcome,reconciled_outcome,invitation_send_proofs(secret_digest,transport,consumed_at))')
   .eq('auth_user_id',input.subject).eq('recipient_email_key',email).eq('status','issued').limit(2)
   .order('invitation_version',{ascending:false,referencedTable:'invitation_send_attempts'}).limit(1,{referencedTable:'invitation_send_attempts'}).retry(false);
  if(result.error||!Array.isArray(result.data)||result.data.length>1)throw new Error();if(!result.data.length)return {code:'denied'};
  const row=object(result.data[0]);if(typeof row.id!=='string'||!invitationUuid.test(row.id)||!Number.isSafeInteger(row.version)||(row.version as number)<1||!Array.isArray(row.invitation_send_attempts)||row.invitation_send_attempts.length!==1)throw new Error();
  const attempt=object(row.invitation_send_attempts[0]);if(attempt.invitation_version!==row.version||(attempt.reconciled_outcome??attempt.outcome)!=='accepted')return {code:'denied'};
  if(input.resumeDigest===null){if(attempt.kind!=='initial'||input.type!=='invite')return {code:'denied'};return {code:'eligible',invitationId:row.id,version:row.version as number,attemptId:null};}
  const proof=object(attempt.invitation_send_proofs);if(attempt.kind!=='resend'||proof.secret_digest!==input.resumeDigest||proof.transport!==input.type||proof.consumed_at!==null)return {code:'denied'};
  if(typeof attempt.id!=='string'||!invitationUuid.test(attempt.id))throw new Error();return {code:'eligible',invitationId:row.id,version:row.version as number,attemptId:attempt.id};
 }catch{return {code:'unavailable'};}},
 async recordSetup(input:{identity:VerifiedConfirmation;origin:string;setupDigest:string;resolution:ConfirmationResolution;resumeDigest:string|null;type:'invite'|'recovery'}):Promise<SetupResult>{try{
  const i=input.identity,r=input.resolution,result=await rpc('record_verified_invitation_setup',{p_subject:i.subject,p_email:i.email,p_session_id:i.sessionId,p_origin:input.origin,p_setup_digest:input.setupDigest,p_invitation_id:r.invitationId,p_expected_version:r.version,p_attempt_id:r.attemptId,p_resume_digest:input.resumeDigest,p_transport:input.type});
  if(['denied','stale','conflict'].includes(String(result.code)))return {code:'denied'};
  if(result.code!=='recorded'||typeof result.authorizationId!=='string'||!invitationUuid.test(result.authorizationId))throw new Error();
  return {code:'recorded',authorizationId:result.authorizationId,expiresAt:date(result.expiresAt)};
 }catch{return {code:'unavailable'};}},
 async readSetup(input:{setupDigest:string;identity:VerifiedConfirmation;origin:string}):Promise<SetupReadResult>{try{
  const i=input.identity,result=await rpc('read_verified_invitation_setup',{p_setup_digest:input.setupDigest,p_subject:i.subject,p_email:i.email,p_session_id:i.sessionId,p_origin:input.origin});
  if(result.code==='denied')return {code:'denied'};
  if(result.code!=='authorized'||typeof result.invitationId!=='string'||!invitationUuid.test(result.invitationId)||typeof result.authorizationId!=='string'||!invitationUuid.test(result.authorizationId)||!Number.isSafeInteger(result.version)||(result.version as number)<1)throw new Error();
  return {code:'authorized',invitationId:result.invitationId,version:result.version as number,authorizationId:result.authorizationId,expiresAt:date(result.expiresAt)};
 }catch{return {code:'unavailable'};}},
};}
