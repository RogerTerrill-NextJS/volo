import 'server-only';
import {randomUUID} from 'node:crypto';
import type {MutationPolicy} from './mutation';
import {executeInitialInvitation,invitationEmail,type SendResult} from './invitation-send.ts';
import {createInitialSendPorts} from './invitation-send-provider.ts';

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
