import 'server-only';
import type {MutationPolicy} from './mutation.ts';
import {memberAdminUuid,memberAdminTime} from './member-admin-validation.ts';
export type MemberDisableInput={targetId:string;reason:string};
type Result={code:'disabled'|'already_disabled';userId:string;disabledAt:string}|{code:'self_disable_not_allowed'|'member_unavailable'|'forbidden'|'invalid_input'|'disable_unconfirmed'};
export type MemberDisablePorts={disable:(input:MemberDisableInput)=>Promise<{data:unknown;error:{code?:string}|null}>};
export function parseMemberDisable(value:unknown):MemberDisableInput|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const r=value as Record<string,unknown>;
 if(Object.keys(r).length!==3||Object.keys(r).some(k=>!['target_id','reason','confirmation'].includes(k))||typeof r.target_id!=='string'||!memberAdminUuid.test(r.target_id.toLowerCase())||r.confirmation!=='disable'||typeof r.reason!=='string')return null;
 const reason=r.reason.replace(/\r\n?/g,'\n').trim();
 if(!reason.isWellFormed()||reason.includes('\u0000')||[...reason].length<1||[...reason].length>500)return null;
 return {targetId:r.target_id.toLowerCase(),reason};
}
function createPorts():MemberDisablePorts{return {async disable(input){const {flightMutationClient}=await import('../flights/client.ts');return(await flightMutationClient()).rpc('admin_disable_member',{p_target_id:input.targetId,p_reason:input.reason}).retry(false);}};}
/** The locked database operation owns actor identity, current role, time and audit atomicity. */
export function memberDisablePolicy(ports:MemberDisablePorts=createPorts()):MutationPolicy<MemberDisableInput,Result>{return {
 allowedRoles:['admin'],parse(raw){const value=parseMemberDisable(raw);return value?{ok:true,value}:{ok:false};},
 authorize(member){return member.role==='admin';},
 async effect(member,input){
  if(member.role!=='admin')return {code:'forbidden'};
  if(member.userId===input.targetId)return {code:'self_disable_not_allowed'};
  try{
   const {data,error}=await ports.disable(input);
   if(error)return {code:error.code==='42501'?'forbidden':error.code==='22023'?'invalid_input':'disable_unconfirmed'};
   if(data&&typeof data==='object'&&!Array.isArray(data)){
    const r=data as Record<string,unknown>;
    if(['self_disable_not_allowed','member_unavailable'].includes(String(r.code)))return {code:r.code as 'self_disable_not_allowed'|'member_unavailable'};
    if((r.code==='disabled'||r.code==='already_disabled')&&r.userId===input.targetId&&memberAdminTime(r.disabledAt))return {code:r.code,userId:input.targetId,disabledAt:r.disabledAt};
   }
  }catch{/* A commit may already exist. Explicit status check/retry must confirm it. */}
  return {code:'disable_unconfirmed'};
 },
};}
