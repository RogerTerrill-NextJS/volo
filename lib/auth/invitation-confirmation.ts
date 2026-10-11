import 'server-only';
import {createConfirmationStore,type VerifiedConfirmation} from './invitation-confirmation-store.ts';
import {newConfirmationSecret,sealConfirmation,openConfirmation,confirmationDigest,isConfirmationSecret,type ConfirmationPayloadWithoutCsrf} from './invitation-confirmation-crypto.ts';
import type {readInvitationEligibility} from './invitation-eligibility.ts';
export type TransportPorts={store:ReturnType<typeof createConfirmationStore>;newSecret:typeof newConfirmationSecret;seal:typeof sealConfirmation;open:typeof openConfirmation;digest:typeof confirmationDigest;now:()=>number};
export type AcceptancePorts=TransportPorts&{verify:(payload:ConfirmationPayloadWithoutCsrf)=>Promise<{code:'verified';identity:VerifiedConfirmation}|{code:'denied'|'unavailable'}>;eligible:typeof readInvitationEligibility};
export async function createConfirmationTransport(input:ConfirmationPayloadWithoutCsrf&{origin:string;previousCookie:string|null},ports:TransportPorts):Promise<{code:'created';cookie:string}|{code:'denied'|'unavailable'}>{
 try{
  const cookie=ports.newSecret(),csrf=ports.newSecret(),expiresAt=new Date(ports.now()+600000).toISOString(),lookupDigest=ports.digest(cookie);
  const envelope=ports.seal({tokenHash:input.tokenHash,type:input.type,resume:input.resume,csrf,...(input.flow?{flow:input.flow}:{})},{lookupDigest,origin:input.origin,expiresAt});
  const result=await ports.store.create({lookupDigest,csrfDigest:ports.digest(csrf),origin:input.origin,envelope,previousDigest:isConfirmationSecret(input.previousCookie)?ports.digest(input.previousCookie):null});
  return result.code==='created'?{code:'created',cookie}:{code:result.code==='limited'?'denied':result.code};
 }catch{return {code:'unavailable'};}
}
export async function acceptInvitationConfirmation(input:{cookie:string;csrf:string;origin:string},ports:AcceptancePorts):Promise<{code:'accepted';setupCookie:string}|{code:'denied'|'unavailable'}>{
 try{
  if(!isConfirmationSecret(input.cookie)||!isConfirmationSecret(input.csrf))return {code:'denied'};
  const lookupDigest=ports.digest(input.cookie),claimed=await ports.store.claim({lookupDigest,csrfDigest:ports.digest(input.csrf),origin:input.origin});
  if(claimed.code!=='claimed')return {code:claimed.code==='unavailable'?'unavailable':'denied'};
  const payload=ports.open(claimed.envelope,{lookupDigest,origin:input.origin,expiresAt:claimed.envelope.expiresAt});
  if(!payload||payload.csrf!==input.csrf||payload.flow==='recovery')return {code:'denied'};
  const verified=await ports.verify({tokenHash:payload.tokenHash,type:payload.type,resume:payload.resume});if(verified.code!=='verified')return verified;
  const identity=verified.identity,resumeDigest=payload.resume?ports.digest(payload.resume):null;
  const resolution=await ports.store.resolveInvitation({subject:identity.subject,email:identity.email,resumeDigest,type:payload.type});if(resolution.code!=='eligible')return resolution;
  const eligibility=await ports.eligible({invitationId:resolution.invitationId,expectedVersion:resolution.version,verifiedSubject:identity.subject,verifiedEmail:identity.email});
  if(eligibility!=='eligible')return {code:eligibility==='unavailable'?'unavailable':'denied'};
  const setupCookie=ports.newSecret(),recorded=await ports.store.recordSetup({identity,origin:input.origin,setupDigest:ports.digest(setupCookie),resolution,resumeDigest,type:payload.type});
  return recorded.code==='recorded'?{code:'accepted',setupCookie}:recorded;
 }catch{return {code:'unavailable'};}
}

export async function acceptRecoveryConfirmation(input:{cookie:string;csrf:string;origin:string},ports:Omit<AcceptancePorts,'eligible'>):Promise<{code:'recovered';recoveryCookie:string}|{code:'denied'|'unavailable'}>{
 try{
  if(!isConfirmationSecret(input.cookie)||!isConfirmationSecret(input.csrf))return {code:'denied'};
  const lookupDigest=ports.digest(input.cookie),claimed=await ports.store.claim({lookupDigest,csrfDigest:ports.digest(input.csrf),origin:input.origin});
  if(claimed.code!=='claimed')return {code:claimed.code==='unavailable'?'unavailable':'denied'};
  const payload=ports.open(claimed.envelope,{lookupDigest,origin:input.origin,expiresAt:claimed.envelope.expiresAt});
  if(!payload||payload.csrf!==input.csrf||payload.flow!=='recovery'||payload.type!=='recovery'||payload.resume!==null)return {code:'denied'};
  const verified=await ports.verify(payload);if(verified.code!=='verified')return verified;
  const recoveryCookie=ports.newSecret(),recorded=await ports.store.recovery('record',{digest:ports.digest(recoveryCookie),identity:verified.identity,origin:input.origin});
  return recorded.code==='recorded'?{code:'recovered',recoveryCookie}:{code:recorded.code==='unavailable'?'unavailable':'denied'};
 }catch{return {code:'unavailable'};}
}
