import 'server-only';
import type {MutationPolicy} from '../auth/mutation.ts';
import {memberAdminUuid,memberAdminTime} from '../auth/member-admin-validation.ts';
export type FlightModerationInput={flightId:string;reason:string};
export type FlightModerationResult={code:'hidden'|'already_hidden';flightId:string;moderatedAt:string;status:'cancelled'|'completed'}|{code:'flight_unavailable'|'forbidden'|'invalid_input'|'moderation_unconfirmed'};
export type FlightModerationPorts={hide:(input:FlightModerationInput)=>Promise<{data:unknown;error:{code?:string}|null}>};
export function parseFlightModeration(raw:unknown):FlightModerationInput|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const r=raw as Record<string,unknown>;
 if(Object.keys(r).length!==3||Object.keys(r).some(k=>!['flight_id','reason','confirmation'].includes(k))||typeof r.flight_id!=='string'||!memberAdminUuid.test(r.flight_id.toLowerCase())||r.confirmation!=='hide'||typeof r.reason!=='string')return null;
 const reason=r.reason.replace(/\r\n?/g,'\n').trim();
 if(!reason.isWellFormed()||reason.includes('\u0000')||[...reason].length<1||[...reason].length>500)return null;
 return {flightId:r.flight_id.toLowerCase(),reason};
}
function createPorts():FlightModerationPorts{return {async hide(input){const {flightMutationClient}=await import('./client.ts');return(await flightMutationClient()).rpc('admin_hide_flight',{p_flight_id:input.flightId,p_reason:input.reason}).retry(false);}};}
/** Actor identity, current authority, closure and immutable audit belong to SQL. */
export function flightModerationPolicy(ports:FlightModerationPorts=createPorts()):MutationPolicy<FlightModerationInput,FlightModerationResult>{return {
 allowedRoles:['admin'],parse(raw){const value=parseFlightModeration(raw);return value?{ok:true,value}:{ok:false};},
 authorize(member){return member.role==='admin';},
 async effect(member,input){
  if(member.role!=='admin')return {code:'forbidden'};
  try{
   const {data,error}=await ports.hide(input);
   if(error)return {code:error.code==='42501'?'forbidden':error.code==='22023'?'invalid_input':'moderation_unconfirmed'};
   if(data&&typeof data==='object'&&!Array.isArray(data)){
    const r=data as Record<string,unknown>;
    if(r.code==='flight_unavailable')return {code:'flight_unavailable'};
    if((r.code==='hidden'||r.code==='already_hidden')&&r.flightId===input.flightId&&memberAdminTime(r.moderatedAt)&&(r.status==='cancelled'||r.status==='completed'))return {code:r.code,flightId:input.flightId,moderatedAt:r.moderatedAt,status:r.status};
   }
  }catch{/* A commit may exist. Only a fresh status read can establish its result. */}
  return {code:'moderation_unconfirmed'};
 },
};}
