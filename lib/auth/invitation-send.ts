import 'server-only';

export type SendCommand = Readonly<{operationId:string;recipientEmail:string;requesterId:string}>;
export type SendResult = Readonly<{code:'accepted'|'rejected'|'conflict'|'pending_reconciliation'|'unavailable'}>;
export type ReservedSend = {code:'reserved';invitationId:string;attemptId:string;version:number;recipientEmail:string;fresh:boolean;outcome:'started'|'accepted'|'rejected'|'unknown'};
export type Reservation = ReservedSend | {code:'denied'|'conflict'|'invalid_input'};
export type ProviderIdentity = {subjectId:string;email:string};
export type SafeSendError = 'timeout'|'provider_rejected'|'rate_limited'|'provider_unavailable'|'identity_conflict'|'unknown';
export type ProviderResult = {code:'accepted';identity:ProviderIdentity}|{code:'rejected'|'unknown';errorCode:SafeSendError};
export type InitialSendPorts = {
 currentAdmin(requesterId:string):Promise<boolean>;
 reserve(command:SendCommand):Promise<Reservation>;
 createSubject(operationId:string,email:string):Promise<ProviderResult>;
 bind(reservation:ReservedSend,requesterId:string,subjectId:string):Promise<'bound'|'denied'|'stale'|'conflict'>;
 invite(email:string):Promise<ProviderResult>;
 record(reservation:ReservedSend,outcome:'accepted'|'rejected'|'unknown',subjectId:string|null,errorCode:SafeSendError|null):Promise<'recorded'|'stale'|'conflict'>;
};
export const invitationUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function invitationEmail(value:unknown):string|null {
 if(typeof value!=='string')return null;
 const email=value.trim();
 return email.length<=254 && /^[\x21-\x7e]+@[\x21-\x7e]+$/.test(email) && email.split('@').length===2 ? email : null;
}
export function invitationEmailKey(value:unknown):string|null {
 return invitationEmail(value)?.replace(/[A-Z]/g,c=>c.toLowerCase())??null;
}

/** Internal server operation. Requester/operation IDs come only from the guarded
 * mutation effect. Durable replay never authorizes another provider operation. */
export async function executeInitialInvitation(command:SendCommand,ports:InitialSendPorts):Promise<SendResult> {
 let reservation:ReservedSend|undefined;
 let subject:string|null=null;
 const finish=async(outcome:'accepted'|'rejected'|'unknown',error:SafeSendError|null):Promise<SendResult>=>{
  try {
   if(!reservation || await ports.record(reservation,outcome,subject,error)!=='recorded')return {code:'pending_reconciliation'};
   return {code:outcome==='unknown'?'pending_reconciliation':outcome};
  }catch{return {code:'pending_reconciliation'};}
 };
 const matches=(identity:ProviderIdentity)=>identity.subjectId===command.operationId && invitationEmailKey(identity.email)===invitationEmailKey(reservation?.recipientEmail);
 try {
  if(!invitationUuid.test(command.operationId)||!invitationUuid.test(command.requesterId)||!invitationEmail(command.recipientEmail))return {code:'rejected'};
  if(!await ports.currentAdmin(command.requesterId))return {code:'rejected'};
  const result=await ports.reserve(command);
  if(result.code!=='reserved')return {code:result.code==='conflict'?'conflict':'rejected'};
  reservation=result;
  if(!result.fresh)return {code:result.outcome==='started'||result.outcome==='unknown'?'pending_reconciliation':result.outcome};
  const created=await ports.createSubject(command.operationId,result.recipientEmail);
  if(created.code!=='accepted')return finish(created.code,created.errorCode);
  if(!matches(created.identity))return finish('unknown','identity_conflict');
  subject=created.identity.subjectId;
  if(await ports.bind(result,command.requesterId,subject)!=='bound')return finish('rejected','identity_conflict');
  if(!await ports.currentAdmin(command.requesterId))return finish('rejected','provider_rejected');
  const sent=await ports.invite(result.recipientEmail);
  if(sent.code!=='accepted')return finish(sent.code,sent.errorCode);
  if(!matches(sent.identity))return finish('unknown','identity_conflict');
  return finish('accepted',null);
 }catch{return reservation?finish('unknown','unknown'):{code:'unavailable'};}
}
