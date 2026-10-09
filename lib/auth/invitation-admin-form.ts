import 'server-only';
import {invitationResendPolicy,invitationSendInspectionPolicy} from './invitation-issuance.ts';
export function invitationGenerationFormPolicy(inspect=false){
 const policy=inspect?invitationSendInspectionPolicy():invitationResendPolicy();
 return {...policy,parse(raw:unknown){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {ok:false} as const;
  const value=raw as Record<string,unknown>;
  if(typeof value.expectedVersion!=='string'||! /^[1-9][0-9]*$/.test(value.expectedVersion))return {ok:false} as const;
  return policy.parse({...value,expectedVersion:Number(value.expectedVersion)});
 }};
}
