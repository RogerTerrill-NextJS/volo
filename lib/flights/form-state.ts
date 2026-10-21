import type {FlightField} from './validation';

export type FlightFormState={revision:number;status:'editing'|'created'|'unconfirmed'|'denied';values:Partial<Record<FlightField,string>>;fieldErrors:Partial<Record<FlightField,string>>;message:string|null;flightId?:string};
export type FlightFormResult={code:string;message?:string;fieldErrors?:Partial<Record<FlightField|'recipient_ids',string>>;flightId?:string;recipientCount?:number};
export const emptyFlightForm:FlightFormState={revision:0,status:'editing',values:{},fieldErrors:{},message:null};
const limits={departure_airport:8,destination_airport:8,departure_local_date:10,departure_local_time:8,departure_timezone:100,departure_occurrence:7,aircraft_description:500,pilot_places:10,notes:2000} as const;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function flightFormResult(previous:FlightFormState,form:FormData,result:FlightFormResult):FlightFormState{
 const revision=Number.isSafeInteger(previous?.revision)&&previous.revision>=0&&previous.revision<1000000?previous.revision+1:1;
 const visibility=form.get('visibility');
 const approvedVisibility=visibility==='NETWORK'||visibility==='PRIVATE'?visibility:undefined;
 if(result.code==='created'&&typeof result.flightId==='string'&&uuid.test(result.flightId)&&approvedVisibility)return {revision,status:'created',values:{},fieldErrors:{},message:approvedVisibility==='PRIVATE'?(result.recipientCount&&result.recipientCount>0?'Private flight published to your selected pilots.':'Private flight published. Only you can see it; no other pilots have been selected.'):'Flight published to the Volo network.',flightId:result.flightId};
 const values:FlightFormState['values']={};
 // Never echo identity, action metadata or arbitrary fields into rendered state.
 for(const [key,limit] of Object.entries(limits)){
  const value=form.get(key);if(typeof value==='string')values[key as keyof typeof limits]=[...value].slice(0,limit).join('');
 }
 if(approvedVisibility)values.visibility=approvedVisibility;
 if(['created','unavailable','internal_error'].includes(result.code))return {revision,status:'unconfirmed',values,fieldErrors:{},message:'Unable to confirm publication. Verify your flights before trying again. Do not submit this flight again until you have checked whether it was published.'};
 const denied=['unauthenticated','forbidden','profile_required'].includes(result.code);
 const fieldErrors:FlightFormState['fieldErrors']={};
 if(result.code==='invalid_input')for(const key of [...Object.keys(limits),'visibility'] as FlightField[]){const error=result.fieldErrors?.[key];if(error)fieldErrors[key]=error;}
 if(result.code==='invalid_input'&&result.fieldErrors?.recipient_ids)fieldErrors.visibility='Check your private recipient selection.';
 const message=result.code==='profile_required'?'Complete your pilot profile before posting a flight.':denied?'Your access could not be verified. Return to the dashboard before posting.':result.code==='too_large'?'Your flight details are too large. Shorten the aircraft description or notes.':'Check the highlighted flight fields.';
 return {revision,status:denied?'denied':'editing',values,fieldErrors,message};
}
