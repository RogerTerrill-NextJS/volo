import type {Database} from '../supabase/database.types';
import {normalizeAirportIdentifier} from '../validation/airport.ts';
import {resolveDeparture,type DepartureCode} from './time.ts';

type FlightInsert=Database['public']['Tables']['flights']['Insert'];
export type FlightFields=Pick<FlightInsert,'departure_airport'|'destination_airport'|'departure_at'|'departure_timezone'|'departure_local_date'|'aircraft_description'|'pilot_places'|'visibility'> & {notes:string|null};
export type FlightField='departure_airport'|'destination_airport'|'departure_local_date'|'departure_local_time'|'departure_timezone'|'departure_occurrence'|'aircraft_description'|'pilot_places'|'notes'|'visibility';
export type FlightValidation={ok:true;value:FlightFields}|{ok:false;fieldErrors:Partial<Record<FlightField,string>>;message:string};
const fields:readonly FlightField[]=['departure_airport','destination_airport','departure_local_date','departure_local_time','departure_timezone','departure_occurrence','aircraft_description','pilot_places','notes','visibility'];
const validText=(value:unknown):value is string=>typeof value==='string'&&value.isWellFormed()&&!value.includes('\u0000');
const length=(text:string)=>[...text].length;
const timeErrors:Record<DepartureCode,[FlightField,string]>={
  invalid_date:['departure_local_date','Enter a valid departure date.'],
  invalid_time:['departure_local_time','Enter a departure time as HH:MM or HH:MM:SS.'],
  invalid_timezone:['departure_timezone','Choose a named departure timezone or UTC.'],
  invalid_occurrence:['departure_occurrence','Choose the earlier or later occurrence.'],
  nonexistent_time:['departure_local_time','This local time does not exist in the departure timezone. Choose another time.'],
  ambiguous_time:['departure_occurrence','This local time occurs twice. Choose the earlier or later occurrence.'],
};

/** Content validation only. Server callers must separately verify current access and ownership. */
export function validateFlight(raw:unknown):FlightValidation {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(raw))||
    Object.keys(raw).some(key=>!fields.includes(key as FlightField))){
    return {ok:false,fieldErrors:{},message:'The flight contains unsupported fields.'};
  }
  const input=raw as Record<string,unknown>,fieldErrors:Partial<Record<FlightField,string>>={};
  const departure_airport=normalizeAirportIdentifier(input.departure_airport),destination_airport=normalizeAirportIdentifier(input.destination_airport);
  for(const [field,value] of [['departure_airport',departure_airport],['destination_airport',destination_airport]] as const)if(!value)fieldErrors[field]='Enter an airport identifier of 2–8 letters or numbers.';
  const aircraft=validText(input.aircraft_description)?input.aircraft_description.trim():'';
  if(!aircraft||length(aircraft)>500)fieldErrors.aircraft_description='Enter an aircraft description of 1–500 characters.';
  let notes:string|null=null;
  if(input.notes!==undefined&&input.notes!==null){
    if(!validText(input.notes)||length(input.notes.trim())>2000)fieldErrors.notes='Use at most 2,000 characters.';
    else notes=input.notes.trim()||null;
  }
  const places=typeof input.pilot_places==='string'&&/^\d+$/.test(input.pilot_places)?Number(input.pilot_places):input.pilot_places;
  if(typeof places!=='number'||!Number.isInteger(places)||places<1||places>2147483647)fieldErrors.pilot_places='Enter a whole number of joining-pilot places greater than zero.';
  if(input.visibility!=='NETWORK'&&input.visibility!=='PRIVATE')fieldErrors.visibility='Choose NETWORK or PRIVATE visibility.';
  const departure=resolveDeparture({localDate:input.departure_local_date,localTime:input.departure_local_time,timeZone:input.departure_timezone,occurrence:input.departure_occurrence});
  if(!departure.ok){const [field,message]=timeErrors[departure.code];fieldErrors[field]=message;}
  if(Object.keys(fieldErrors).length||!departure.ok||!departure_airport||!destination_airport)return {ok:false,fieldErrors,message:'Check the highlighted flight fields.'};
  return {ok:true,value:{departure_airport,destination_airport,...departure.value,aircraft_description:aircraft,pilot_places:places as number,notes,visibility:input.visibility as FlightFields['visibility']}};
}

/** Creation adds a future-departure requirement; edits retain shared content validation. */
export function validateFlightForCreation(raw:unknown,now:number=Date.now()):FlightValidation {
  const result=validateFlight(raw);
  if(!result.ok)return result;
  if(!Number.isFinite(now)||Date.parse(result.value.departure_at)<=now){
    return {ok:false,fieldErrors:{departure_local_time:'Choose a future departure time.'},message:'Check the highlighted flight fields.'};
  }
  return result;
}
