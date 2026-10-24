import 'server-only';
import type {MutationPolicy} from '../auth/mutation';
import {parseCancellationInput,type CancellationInput} from './cancellation-input.ts';
export type CancellationResult={code:string;flightId?:string;status?:string};
export type CancellationPorts={cancel:(flight:string)=>Promise<{data:unknown;error:{code?:string}|null}>};
function createPorts():CancellationPorts{return {async cancel(flight){const {flightMutationClient}=await import('./client.ts');return(await flightMutationClient()).rpc('cancel_flight',{p_flight_id:flight}).retry(false);}};}
/** The locked RPC derives current owner/admin authority from the session. */
export function cancellationPolicy(ports:CancellationPorts=createPorts()):MutationPolicy<CancellationInput,CancellationResult>{return {
 allowedRoles:['member','admin'],
 parse(raw){const value=parseCancellationInput(raw);return value?{ok:true,value}:{ok:false};},
 authorize(){return true;},
 async effect(_member,input){try{
  const {data,error}=await ports.cancel(input.flightId);
  if(error)return {code:error.code==='42501'?'forbidden':error.code==='22023'?'invalid_input':'unavailable'};
  if(!data||typeof data!=='object'||Array.isArray(data))return {code:'unavailable'};
  const value=data as Record<string,unknown>;
  if(value.code==='flight_conflict')return {code:value.code};
  if((value.code==='cancelled'||value.code==='already_cancelled')&&value.flightId===input.flightId&&value.status==='cancelled')return {code:value.code,flightId:input.flightId,status:'cancelled'};
  return {code:'unavailable'};
 }catch{return {code:'unavailable'};}},
};}
