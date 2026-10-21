import 'server-only';
import type {MutationPolicy} from '../auth/mutation';
import {flightMutationClient} from './client';
import {validateFlightWithRecipients,type PostingValidation,type PostingField} from './recipients.ts';

export type FlightCreateResult={code:'created';flightId:string;recipientCount:number}
  |{code:'invalid_input';message:string;fieldErrors:Partial<Record<PostingField,string>>}
  |{code:'forbidden'|'unavailable';message:string};
const unavailable:FlightCreateResult={code:'unavailable',message:'Unable to confirm creation. Verify your flights before trying again.'};
const invalid:FlightCreateResult={code:'invalid_input',message:'Check the flight details and choose a future departure.',fieldErrors:{}};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fresh identity/profile gates precede the session RPC; SQL independently checks both. */
export function flightCreatePolicy(requirePrivateRecipients=false):MutationPolicy<PostingValidation,FlightCreateResult>{
  return {
    allowedRoles:['member','admin'],requireCompleteProfile:true,
    parse(raw){return {ok:true,value:validateFlightWithRecipients(raw,Date.now(),requirePrivateRecipients)};},
    authorize(){return true;},
    async effect(_member,input){
      if(!input.ok)return {code:'invalid_input',message:input.message,fieldErrors:input.fieldErrors};
      try{
        const client=await flightMutationClient();
        const value=input.value;
        // No caller-selected identity/status. Empty optional text maps back to SQL NULL.
        const args={
          p_departure_airport:value.departure_airport,p_destination_airport:value.destination_airport,
          p_departure_at:value.departure_at,p_departure_timezone:value.departure_timezone,
          p_aircraft_description:value.aircraft_description,p_pilot_places:value.pilot_places,
          p_notes:value.notes??'',
        };
        const result=await (input.recipientIds.length?client.rpc('create_private_flight',{...args,p_recipient_ids:input.recipientIds}):client.rpc('create_flight',{...args,p_visibility:value.visibility})).retry(false);
        if(result.error){
          if(result.error.code==='42501')return {code:'forbidden',message:'Access denied.'};
          if(input.recipientIds.length&&result.error.code==='22023'&&result.error.message==='Invalid private selection')return {code:'invalid_input',message:'Check your private recipient selection.',fieldErrors:{recipient_ids:'Some selected pilots are no longer eligible. Review your selection and try again.'}};
          if(['22023','23502','23503','23514','22P02'].includes(result.error.code))return invalid;
          return unavailable;
        }
        if(typeof result.data!=='string'||!uuid.test(result.data))return unavailable;
        return {code:'created',flightId:result.data,recipientCount:input.recipientIds.length};
      }catch{return unavailable;}
    },
  };
}
