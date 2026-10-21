import 'server-only';
import type {MutationPolicy} from '../auth/mutation';
import {flightMutationClient} from './client';
import {canEditFlight} from './ownership';
import {parseRecipientChange} from './recipients.ts';

type Change={flightId:string;recipientId:string};
type Result={code:'updated';flightId:string;selected:boolean}|{code:'forbidden'|'invalid_input'|'unavailable'|'lifecycle_unavailable';message:string};
const unavailable:Result={code:'unavailable',message:'Unable to confirm recipient changes. Verify the audience before trying again.'};

export function recipientMutationPolicy(selected:boolean):MutationPolicy<Change,Result>{
 let client:Awaited<ReturnType<typeof flightMutationClient>>;
 return {
  allowedRoles:['member','admin'],
  parse(raw){const value=parseRecipientChange(raw);return value?{ok:true,value}:{ok:false};},
  async authorize(member,input){
   client=await flightMutationClient();
   const row=await client.from('flights').select('owner_id').eq('id',input.flightId).retry(false).maybeSingle();
   if(row.error)throw new Error('Flight unavailable');
   return canEditFlight({status:'authorized',member},row.data);
  },
  async effect(_member,input){
   try{
    const result=await client.rpc('change_flight_recipient',{p_flight_id:input.flightId,p_recipient_id:input.recipientId,p_selected:selected}).retry(false);
    if(result.error?.code==='42501')return {code:'forbidden',message:'Access denied.'};
    if(result.error?.code==='22023')return {code:'invalid_input',message:'Choose a valid recipient for a PRIVATE flight.'};
    if(result.error?.code==='55000')return {code:'lifecycle_unavailable',message:'Recipient removal is unavailable until request and conversation handling is ready.'};
    if(result.error||result.data!==input.flightId)return unavailable;
    return {code:'updated',flightId:input.flightId,selected};
   }catch{return unavailable;}
  },
 };
}
