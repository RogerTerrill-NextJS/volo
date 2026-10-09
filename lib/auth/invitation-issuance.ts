import 'server-only';
import {randomUUID} from 'node:crypto';
import type {MutationPolicy} from './mutation';
import {executeInitialInvitation,invitationEmail,invitationUuid,type SendResult} from './invitation-send.ts';
import {createInitialSendPorts,createResendPorts,createSendInspectionPorts} from './invitation-send-provider.ts';
import {executeInvitationResend,inspectInvitationSend,invitationVersion} from './invitation-resend.ts';

/** Reused by future admin UI; never accept role, identity or redirects as input. */
export function invitationIssuancePolicy():MutationPolicy<{email:string},SendResult> {
 return {
  allowedRoles:['admin'],
  parse(raw){
   if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==1||!Object.hasOwn(raw,'email'))return {ok:false};
   const email=invitationEmail((raw as {email:unknown}).email);
   return email?{ok:true,value:{email}}:{ok:false};
  },
  authorize(){return true;},
  effect(member,input){return executeInitialInvitation({operationId:randomUUID(),recipientEmail:input.email,requesterId:member.userId},createInitialSendPorts());},
 };
}

type GenerationInput={invitationId:string;expectedVersion:number};
function generationPolicy(inspect:boolean):MutationPolicy<GenerationInput,SendResult> {
 return {allowedRoles:['admin'],parse(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==2||!Object.hasOwn(raw,'invitationId')||!Object.hasOwn(raw,'expectedVersion'))return {ok:false};
  const input=raw as Record<string,unknown>;
  return typeof input.invitationId==='string'&&invitationUuid.test(input.invitationId)&&invitationVersion(input.expectedVersion)
   ?{ok:true,value:{invitationId:input.invitationId,expectedVersion:input.expectedVersion}}:{ok:false};
 },authorize(){return true;},effect(member,input){
  const command={...input,requesterId:member.userId};
  return inspect?inspectInvitationSend(command,createSendInspectionPorts()):executeInvitationResend({...command,operationId:randomUUID()},createResendPorts());
 }};
}
export function invitationResendPolicy(){return generationPolicy(false);}
export function invitationSendInspectionPolicy(){return generationPolicy(true);}
