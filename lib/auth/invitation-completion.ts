import 'server-only';
import type {createConfirmationStore,CompletionContext,VerifiedConfirmation} from './invitation-confirmation-store.ts';
import type {readInvitationEligibility} from './invitation-eligibility.ts';
import type {getAccess} from './access.ts';
export type CompletionCode='completed'|'password_rejected'|'retry_later'|'renew_required'|'access_denied';
export type CompletionPorts={
 store:Pick<ReturnType<typeof createConfirmationStore>,'beginCompletion'|'recordPassword'|'releasePassword'|'redeem'>;
 newOperationId():string;eligible:typeof readInvitationEligibility;
 setPassword(password:string):Promise<{code:'updated'|'rejected'|'unknown'}>;
 verifyIdentity():Promise<{code:'verified';identity:VerifiedConfirmation}|{code:'denied'|'unavailable'}>;
 access:typeof getAccess;
};
export async function completeInvitedAccount(input:{setupDigest:string;identity:VerifiedConfirmation;origin:string;password:string},ports:CompletionPorts):Promise<{code:CompletionCode}>{
 try{
  const operationId=ports.newOperationId(),begin=await ports.store.beginCompletion({setupDigest:input.setupDigest,identity:input.identity,origin:input.origin,operationId});
  if(begin.code==='denied')return {code:'access_denied'};
  if(begin.code==='busy'||begin.code==='unavailable')return {code:'retry_later'};
  if(begin.code==='renew_required')return {code:'renew_required'};
  if(!('invitationId' in begin))return {code:'renew_required'};
  const context:CompletionContext={invitationId:begin.invitationId,version:begin.version,authorizationId:begin.authorizationId,setupDigest:input.setupDigest,identity:input.identity,origin:input.origin};
  const owned={...context,operationId};
  if(begin.code!=='redeemed'){
   const eligible=await ports.eligible({invitationId:context.invitationId,expectedVersion:context.version,verifiedSubject:input.identity.subject,verifiedEmail:input.identity.email});
   if(eligible!=='eligible'){
    if(begin.code==='reserved'){const release=await ports.store.releasePassword(owned);if(release.code==='unavailable'||release.code==='denied')return {code:'renew_required'};}
    return {code:eligible==='unavailable'?'retry_later':'access_denied'};
   }
  }
  if(begin.code==='reserved'){
   const password=await ports.setPassword(input.password);
   if(password.code==='unknown')return {code:'renew_required'};
   if(password.code==='rejected'){
    const released=await ports.store.releasePassword(owned);
    if(released.code==='released')return {code:'password_rejected'};
    if(released.code!=='recorded')return {code:'renew_required'};
   }else{
    const verified=await ports.verifyIdentity();
    if(verified.code!=='verified'||verified.identity.subject!==input.identity.subject
     ||verified.identity.email.toLowerCase()!==input.identity.email.toLowerCase()||verified.identity.sessionId!==input.identity.sessionId)return {code:'renew_required'};
    const recorded=await ports.store.recordPassword(owned);
    if(recorded.code==='denied')return {code:'access_denied'};
    if(recorded.code==='unavailable'){
     const released=await ports.store.releasePassword(owned);
     if(released.code==='released')return {code:'retry_later'};
     if(released.code!=='recorded')return {code:'renew_required'};
    }
   }
  }
  const redeemed=await ports.store.redeem(context);
  if(redeemed.code==='unavailable')return {code:'retry_later'};
  if(redeemed.code!=='redeemed'&&redeemed.code!=='already_redeemed')return {code:'access_denied'};
  const access=await ports.access();
  if(access.status==='unavailable')return {code:'retry_later'};
  return {code:access.status==='authorized'&&access.member.userId===input.identity.subject?'completed':'access_denied'};
 }catch{return {code:'renew_required'};}
}
