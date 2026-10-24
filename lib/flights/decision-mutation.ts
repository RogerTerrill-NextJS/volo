import 'server-only';
import type {MutationPolicy} from '../auth/mutation';
import {parseDecisionInput,type DecisionInput} from './decision-input.ts';
export type DecisionResult={code:string;requestId?:string;status?:string};
export type DecisionPorts={readFlight:(id:string)=>Promise<unknown>;decide:(input:DecisionInput)=>Promise<{data:unknown;error:{code?:string}|null}>};
function createPorts():DecisionPorts{return {
 async readFlight(id){const {flightMutationClient}=await import('./client.ts');const client=await flightMutationClient();const result=await client.from('flights').select('owner_id').eq('id',id).retry(false).maybeSingle();if(result.error)throw Error('Flight unavailable');return result.data;},
 async decide(input){const {flightMutationClient}=await import('./client.ts');const client=await flightMutationClient();return client.rpc('decide_flight_request',{p_flight_id:input.flightId,p_request_id:input.requestId,p_decision:input.decision}).retry(false);},
};}
/** Fresh owner guard plus the locked RPC; neither form fields nor admin role grant ownership. */
export function decisionPolicy(ports:DecisionPorts=createPorts()):MutationPolicy<DecisionInput,DecisionResult>{return {
 allowedRoles:['member','admin'],
 parse(raw){const input=parseDecisionInput(raw);return input?{ok:true,value:input}:{ok:false};},
 async authorize(member,input){const row=await ports.readFlight(input.flightId);return Boolean(row&&typeof row==='object'&&'owner_id' in row&&row.owner_id===member.userId);},
 async effect(_member,input){
  try{
   const {data,error}=await ports.decide(input);
   if(error)return {code:error.code==='42501'?'forbidden':error.code==='22023'?'invalid_input':'unavailable'};
   if(!data||typeof data!=='object'||Array.isArray(data))return {code:'unavailable'};
   const value=data as Record<string,unknown>;
   if(typeof value.code==='string'&&['capacity_full','request_conflict','request_unavailable','request_ineligible'].includes(value.code))return {code:value.code};
   if((value.code==='decided'||value.code==='already_decided')&&value.requestId===input.requestId&&value.status===input.decision)return {code:value.code,requestId:input.requestId,status:input.decision};
   return {code:'unavailable'};
  }catch{return {code:'unavailable'};}
 },
};}
