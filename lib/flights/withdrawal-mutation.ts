import type {MutationPolicy} from '../auth/mutation';
import 'server-only';
import {parseWithdrawalInput,type WithdrawalInput} from './withdrawal-input.ts';
export type WithdrawalResult={code:string;flightId?:string;requestId?:string;status?:string};
export type WithdrawalPorts={readRequest:(flight:string,viewer:string)=>Promise<unknown>;withdraw:(flight:string,request:string)=>Promise<{data:unknown;error:{code?:string}|null}>};
function createPorts():WithdrawalPorts{return {
 async readRequest(flight,viewer){const {flightMutationClient}=await import('./client.ts');const result=await(await flightMutationClient()).from('flight_requests').select('id,flight_id,requester_id').eq('flight_id',flight).eq('requester_id',viewer).retry(false).maybeSingle();if(result.error)throw Error('Request unavailable');return result.data;},
 async withdraw(flight,request){const {flightMutationClient}=await import('./client.ts');return(await flightMutationClient()).rpc('withdraw_flight_request',{p_flight_id:flight,p_request_id:request}).retry(false);},
};}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Request identity is session-derived; the locked RPC rechecks current access. */
export function withdrawalPolicy(ports:WithdrawalPorts=createPorts()):MutationPolicy<WithdrawalInput,WithdrawalResult>{return {
 allowedRoles:['member','admin'],
 parse(raw){const value=parseWithdrawalInput(raw);return value?{ok:true,value}:{ok:false};},
 authorize(){return true;},
 async effect(member,input){try{
  const row=await ports.readRequest(input.flightId,member.userId);
  if(!row||typeof row!=='object'||Array.isArray(row))return {code:'request_unavailable'};
  const own=row as Record<string,unknown>;
  if(own.flight_id!==input.flightId||own.requester_id!==member.userId||typeof own.id!=='string'||!uuid.test(own.id))return {code:'request_unavailable'};
  const {data,error}=await ports.withdraw(input.flightId,own.id);
  if(error)return {code:error.code==='42501'?'forbidden':error.code==='22023'?'invalid_input':'unavailable'};
  if(!data||typeof data!=='object'||Array.isArray(data))return {code:'unavailable'};
  const value=data as Record<string,unknown>;
  if(value.code==='request_unavailable'||value.code==='request_conflict')return {code:value.code};
  if((value.code==='withdrawn'||value.code==='already_withdrawn')&&value.requestId===own.id&&value.status==='withdrawn')return {code:value.code,flightId:input.flightId,requestId:own.id,status:'withdrawn'};
  return {code:'unavailable'};
 }catch{return {code:'unavailable'};}},
};}
