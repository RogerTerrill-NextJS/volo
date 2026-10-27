import 'server-only';
import type {MutationPolicy} from '../auth/mutation.ts';
import {parseOutcome,projectOutcome,type OutcomeInput,type FlightOutcome} from './validation.ts';
export type OutcomeResult={code:'saved';outcome:FlightOutcome}|{code:'outcome_unavailable'|'stale'|'outcome_unconfirmed'|'invalid_input'|'forbidden'};
export type OutcomeMutationPorts={save:(input:OutcomeInput)=>Promise<{data:unknown;error:{code?:string}|null}>};
function createPorts():OutcomeMutationPorts{return {async save(input){const client=await(await import('../flights/client.ts')).flightMutationClient();return client.rpc('save_flight_outcome',{p_request_id:input.requestId,p_flew_together:input.answer,p_expected_revision:input.expectedRevision}).retry(false);}};}
export function outcomePolicy(ports:OutcomeMutationPorts=createPorts()):MutationPolicy<OutcomeInput,OutcomeResult>{return {
 allowedRoles:['member','admin'],parse(raw){const value=parseOutcome(raw);return value?{ok:true,value}:{ok:false};},authorize(){return true;},
 async effect(member,input){try{
  const {data,error}=await ports.save(input);if(error)return {code:error.code==='42501'?'forbidden':error.code==='22023'?'invalid_input':'outcome_unconfirmed'};
  if(data&&typeof data==='object'&&!Array.isArray(data)){
   const r=data as Record<string,unknown>;if(r.code==='outcome_unavailable'||r.code==='stale')return {code:r.code};
   const outcome=projectOutcome(r.outcome);if(r.code==='saved'&&outcome&&outcome.requestId===input.requestId&&outcome.answer===input.answer&&outcome.counterpartId!==member.userId)return {code:'saved',outcome};
  }
 }catch{/* It may have committed. Require read recovery before a further correction. */}return {code:'outcome_unconfirmed'};
 },
};}
