import 'server-only';
import {createHash,randomBytes} from 'node:crypto';
import {invitationUuid,invitationEmailKey,type ProviderIdentity,type ProviderResult,type ReservedSend,type SafeSendError,type SendResult} from './invitation-send.ts';

export type ResendCommand = Readonly<{operationId:string;invitationId:string;expectedVersion:number;requesterId:string}>;
export type SendTransport = 'invite'|'recovery';
export type ResendReservation = ReservedSend & {subjectId:string;resolution:'accepted'|'rejected'|null};
export type SubjectInspection = {code:'found';subjectId:string;email:string;confirmed:boolean;banned:boolean}|{code:'missing'|'unavailable'};
export type ResendPorts = {
 currentAdmin(id:string):Promise<boolean>;
 reserve(command:ResendCommand):Promise<ResendReservation|{code:'denied'|'conflict'|'stale'|'pending_reconciliation'|'invalid_input'}>;
 inspectSubject(id:string):Promise<SubjectInspection>;
 prepareProof(r:ResendReservation,requesterId:string,digest:string,transport:SendTransport):Promise<'prepared'|'denied'|'stale'|'conflict'>;
 send(r:ResendReservation,transport:SendTransport,secret:string,canSend:()=>Promise<boolean>):Promise<ProviderResult>;
 record(r:ResendReservation,outcome:'accepted'|'rejected'|'unknown',subjectId:string|null,error:SafeSendError|null):Promise<'recorded'|'stale'|'conflict'>;
};
export const invitationVersion=(value:unknown):value is number=>Number.isSafeInteger(value)&&(value as number)>0&&(value as number)<Number.MAX_SAFE_INTEGER;
const effective=(outcome:string,resolution:string|null):SendResult=>({code:(resolution??outcome)==='accepted'?'accepted':(resolution??outcome)==='rejected'?'rejected':'pending_reconciliation'});

/** Never returns the email proof. Only a fresh durable reservation can send. */
export async function executeInvitationResend(command:ResendCommand,ports:ResendPorts):Promise<SendResult> {
 let reservation:ResendReservation|undefined;
 const finish=async(outcome:'accepted'|'rejected'|'unknown',error:SafeSendError|null):Promise<SendResult>=>{
  try {if(!reservation||await ports.record(reservation,outcome,reservation.subjectId,error)!=='recorded')return {code:'pending_reconciliation'};
   return effective(outcome,null);
  }catch{return {code:'pending_reconciliation'};}
 };
 try {
  if(!invitationUuid.test(command.operationId)||!invitationUuid.test(command.invitationId)||!invitationUuid.test(command.requesterId)||!invitationVersion(command.expectedVersion))return {code:'rejected'};
  if(!await ports.currentAdmin(command.requesterId))return {code:'rejected'};
  const result=await ports.reserve(command);
  if(result.code!=='reserved')return {code:result.code==='pending_reconciliation'?result.code:result.code==='stale'||result.code==='conflict'?'conflict':'rejected'};
  reservation=result;
  if(!result.fresh)return effective(result.outcome,result.resolution);
  if(!await ports.currentAdmin(command.requesterId))return finish('rejected','provider_rejected');
  const subject=await ports.inspectSubject(result.subjectId);
  if(subject.code==='unavailable')return finish('unknown','provider_unavailable');
  if(subject.code!=='found'||subject.banned||subject.subjectId!==result.subjectId||invitationEmailKey(subject.email)!==invitationEmailKey(result.recipientEmail))return finish('rejected','identity_conflict');
  const transport:SendTransport=subject.confirmed?'recovery':'invite';
  const secret=randomBytes(32).toString('base64url');const digest=createHash('sha256').update(secret).digest('hex');
  if(await ports.prepareProof(result,command.requesterId,digest,transport)!=='prepared')return finish('rejected','identity_conflict');
  if(!await ports.currentAdmin(command.requesterId))return finish('rejected','provider_rejected');
  const sent=await ports.send(result,transport,secret,()=>ports.currentAdmin(command.requesterId));
  if(sent.code!=='accepted')return finish(sent.code,sent.errorCode);
  if(sent.identity.subjectId!==result.subjectId||invitationEmailKey(sent.identity.email)!==invitationEmailKey(result.recipientEmail))return finish('unknown','identity_conflict');
  return finish('accepted',null);
 }catch{return reservation?finish('unknown','unknown'):{code:'unavailable'};}
}

export type SendSnapshot = {invitationId:string;attemptId:string;version:number;currentVersion:number;subjectId:string|null;email:string;status:string;kind:'initial'|'resend';outcome:'started'|'accepted'|'rejected'|'unknown';resolution:'accepted'|'rejected'|null};
export type SnapshotQuery = {invitationId?:string;attemptId?:string;expectedVersion:number};
export type SendInspectionPorts = {currentAdmin(id:string):Promise<boolean>;load(query:SnapshotQuery):Promise<SendSnapshot|null>};
export type TrustedSendObservation = {attemptId:string;version:number}&({outcome:'accepted';identity:ProviderIdentity}|{outcome:'rejected';errorCode:SafeSendError});
export type ReconcileCommand = {attemptId:string;expectedVersion:number;requesterId:string};
export type ReconciliationPorts = SendInspectionPorts & {reconcile(command:ReconcileCommand,observation:TrustedSendObservation):Promise<'reconciled'|'denied'|'stale'|'conflict'>};

/** Inspection deliberately does not infer a receipt from provider account state. */
export async function inspectInvitationSend(command:{invitationId:string;expectedVersion:number;requesterId:string},ports:SendInspectionPorts):Promise<SendResult> {
 try {
  if(!invitationUuid.test(command.invitationId)||!invitationUuid.test(command.requesterId)||!invitationVersion(command.expectedVersion)||!await ports.currentAdmin(command.requesterId))return {code:'conflict'};
  const snapshot=await ports.load(command);
  if(!snapshot||snapshot.invitationId!==command.invitationId||snapshot.version!==command.expectedVersion||snapshot.currentVersion!==command.expectedVersion||!['pending_issuance','issued','setup_verified','password_established'].includes(snapshot.status))return {code:'conflict'};
  return effective(snapshot.outcome,snapshot.resolution);
 }catch{return {code:'unavailable'};}
}

/** Internal observed response only, never a browser-selected resolution or a
 * timestamp/email heuristic. A receipt lost with its process remains unknown. */
export async function reconcileInvitationSend(command:ReconcileCommand,observation:TrustedSendObservation,ports:ReconciliationPorts):Promise<SendResult> {
 try {
  if(!invitationUuid.test(command.attemptId)||!invitationUuid.test(command.requesterId)||!invitationVersion(command.expectedVersion)
   ||observation.attemptId!==command.attemptId||observation.version!==command.expectedVersion||!await ports.currentAdmin(command.requesterId))return {code:'conflict'};
  const snapshot=await ports.load(command);
  if(!snapshot||snapshot.attemptId!==command.attemptId||snapshot.version!==command.expectedVersion)return {code:'conflict'};
  if(observation.outcome==='accepted'&&(observation.identity.subjectId!==(snapshot.subjectId??(snapshot.kind==='initial'?snapshot.attemptId:null))
   ||invitationEmailKey(observation.identity.email)!==invitationEmailKey(snapshot.email)))return {code:'conflict'};
  if(observation.outcome!=='accepted'&&observation.outcome!=='rejected')return {code:'conflict'};
  const result=await ports.reconcile(command,observation);
  return result==='reconciled'?{code:observation.outcome}:result==='stale'?{code:'pending_reconciliation'}:{code:'conflict'};
 }catch{return {code:'unavailable'};}
}
