import {validateFlightForCreation,type FlightField,type FlightFields} from './validation.ts';
export type PostingField=FlightField|'recipient_ids';
export type PostingValidation={ok:true;value:FlightFields;recipientIds:string[]}|{ok:false;fieldErrors:Partial<Record<PostingField,string>>;message:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseRecipientIds(input:unknown):string[]|null{
 if(input===undefined)return [];
 if(typeof input!=='string'||new TextEncoder().encode(input).byteLength>16384)return null;
 try{
  const values:unknown=JSON.parse(input);
  if(!Array.isArray(values)||values.some(id=>typeof id!=='string'||!uuid.test(id)))return null;
  const ids=(values as string[]).map(id=>id.toLowerCase());
  return new Set(ids).size===ids.length?ids:null;
 }catch{return null;}
}
export function validateFlightWithRecipients(raw:unknown,now:number=Date.now()):PostingValidation{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))return {ok:false,fieldErrors:{},message:'Invalid flight details.'};
 const {recipient_ids:selection,...content}=raw as Record<string,unknown>;
 const result=validateFlightForCreation(content,now);
 if(!result.ok)return result;
 const recipientIds=parseRecipientIds(selection);
 if(recipientIds===null||recipientIds.length>0&&result.value.visibility!=='PRIVATE')return {ok:false,fieldErrors:{recipient_ids:'Choose valid recipients for a PRIVATE flight.'},message:'Check your private recipient selection.'};
 return {...result,recipientIds};
}
export function parseRecipientChange(raw:unknown):{flightId:string;recipientId:string}|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))return null;
 const input=raw as Record<string,unknown>;
 if(Object.keys(input).some(key=>!['flight_id','recipient_id'].includes(key))||typeof input.flight_id!=='string'||!uuid.test(input.flight_id)||typeof input.recipient_id!=='string'||!uuid.test(input.recipient_id))return null;
 return {flightId:input.flight_id.toLowerCase(),recipientId:input.recipient_id.toLowerCase()};
}
