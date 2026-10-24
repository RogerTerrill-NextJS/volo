import type {MutationPolicy} from '../auth/mutation';
import 'server-only';
import {validateEditInput,normalizeEditInstant,type EditInput,type EditValidation} from './edit-input.ts';
import type {FlightFormResult} from './form-state.ts';
export type EditResult=FlightFormResult&{updatedAt?:string};
export type EditPorts={readRow:(flight:string)=>Promise<unknown>;edit:(input:EditInput)=>Promise<{data:unknown;error:{code?:string}|null}>};
function createPorts():EditPorts{return {
 async readRow(id){const {flightMutationClient}=await import('./client.ts');const r=await(await flightMutationClient()).from('flights').select('id,owner_id,departure_at,departure_timezone').eq('id',id).retry(false).maybeSingle();if(r.error)throw Error('Flight unavailable');return r.data;},
 async edit(input){const {flightMutationClient}=await import('./client.ts'),v=input.value;return(await flightMutationClient()).rpc('edit_flight',{p_flight_id:input.flightId,p_expected_updated_at:input.expectedUpdatedAt,p_departure_airport:v.departure_airport,p_destination_airport:v.destination_airport,p_departure_at:v.departure_at,p_departure_timezone:v.departure_timezone,p_aircraft_description:v.aircraft_description,p_pilot_places:v.pilot_places,p_notes:v.notes??''}).retry(false);},
};}
export function flightEditPolicy(ports:EditPorts=createPorts()):MutationPolicy<EditValidation,EditResult>{return {
 allowedRoles:['member','admin'],requireCompleteProfile:true,
 parse(raw){return {ok:true,value:validateEditInput(raw)};},authorize(){return true;},
 async effect(member,parsed){
  if(!parsed.ok)return {code:'invalid_input',fieldErrors:parsed.fieldErrors};
  try{
   const input=parsed.input,row=await ports.readRow(input.flightId);
   if(!row||typeof row!=='object'||!('id' in row)||row.id!==input.flightId||!('owner_id' in row)||row.owner_id!==member.userId)return {code:'forbidden'};
   if(!('departure_at' in row)||!('departure_timezone' in row))return {code:'unavailable'};
   const original=normalizeEditInstant(row.departure_at);if(!original)return {code:'unavailable'};
   // The form edits seconds; preserve an unchanged stored microsecond instant.
   const unchanged=row.departure_timezone===input.value.departure_timezone&&original.slice(0,19)===input.value.departure_at.slice(0,19);
   const bound={...input,value:{...input.value,...(unchanged?{departure_at:original}:{})}};
   const {data,error}=await ports.edit(bound);
   if(error)return {code:error.code==='42501'?'forbidden':error.code==='22023'?'invalid_input':'unavailable'};
   if(!data||typeof data!=='object'||Array.isArray(data))return {code:'unavailable'};
   const v=data as Record<string,unknown>;
   if(typeof v.code==='string'&&['flight_conflict','capacity_conflict','repost_required','flight_unavailable'].includes(v.code))return {code:v.code};
   const updatedAt=normalizeEditInstant(v.updatedAt);
   if((v.code==='updated'||v.code==='already_updated')&&v.flightId===input.flightId&&updatedAt)return {code:v.code,flightId:input.flightId,updatedAt};
   return {code:'unavailable'};
  }catch{return {code:'unavailable'};}
 },
};}
