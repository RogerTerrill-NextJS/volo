import 'server-only';
import type {MutationPolicy} from '../auth/mutation';
import {createServerSupabaseClient} from '../supabase/server';
import {validateFlightForCreation,type FlightValidation,type FlightField} from './validation.ts';

export type FlightCreateResult={code:'created';flightId:string}
  |{code:'invalid_input';message:string;fieldErrors:Partial<Record<FlightField,string>>}
  |{code:'forbidden'|'unavailable';message:string};
const unavailable:FlightCreateResult={code:'unavailable',message:'Unable to confirm creation. Verify your flights before trying again.'};
const invalid:FlightCreateResult={code:'invalid_input',message:'Check the flight details and choose a future departure.',fieldErrors:{}};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fresh identity/profile gates precede the session RPC; SQL independently checks both. */
export function flightCreatePolicy():MutationPolicy<FlightValidation,FlightCreateResult>{
  return {
    allowedRoles:['member','admin'],requireCompleteProfile:true,
    parse(raw){return {ok:true,value:validateFlightForCreation(raw)};},
    authorize(){return true;},
    async effect(_member,input){
      if(!input.ok)return {code:'invalid_input',message:input.message,fieldErrors:input.fieldErrors};
      try{
        const deadline=AbortSignal.timeout(5000);
        const client=await createServerSupabaseClient({cookieMode:'read-only',fetch:async(url,init)=>{
          const response=await fetch(url,{...init,signal:init?.signal?AbortSignal.any([deadline,init.signal]):deadline,cache:'no-store',redirect:'error'});
          return new Response(await response.text(),{status:response.status,headers:response.headers});
        }});
        const value=input.value;
        // No caller-selected identity/status. Empty optional text maps back to SQL NULL.
        const result=await client.rpc('create_flight',{
          p_departure_airport:value.departure_airport,p_destination_airport:value.destination_airport,
          p_departure_at:value.departure_at,p_departure_timezone:value.departure_timezone,
          p_aircraft_description:value.aircraft_description,p_pilot_places:value.pilot_places,
          p_notes:value.notes??'',p_visibility:value.visibility,
        }).retry(false);
        if(result.error){
          if(result.error.code==='42501')return {code:'forbidden',message:'Access denied.'};
          if(['22023','23502','23503','23514','22P02'].includes(result.error.code))return invalid;
          return unavailable;
        }
        if(typeof result.data!=='string'||!uuid.test(result.data))return unavailable;
        return {code:'created',flightId:result.data};
      }catch{return unavailable;}
    },
  };
}
