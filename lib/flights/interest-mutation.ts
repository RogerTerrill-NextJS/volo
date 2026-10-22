import 'server-only';
import type {MutationPolicy} from '../auth/mutation';
import {flightMutationClient} from './client';
import {parseInterestInput,type InterestInput} from './interest-input.ts';

export type InterestResult={code:'submitted';requestId:string;status:'pending'}
 |{code:'already_requested';requestId:string;status:'pending'|'accepted'}
 |{code:'flight_unavailable'|'request_closed'|'forbidden'|'invalid_input'|'unavailable';message:string};
const unavailable:InterestResult={code:'unavailable',message:'Unable to confirm your request. Check its status before trying again.'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function interestSubmissionPolicy():MutationPolicy<InterestInput,InterestResult>{
 return {
  allowedRoles:['member','admin'],requireCompleteProfile:true,
  parse(raw){const value=parseInterestInput(raw);return value?{ok:true,value}:{ok:false};},
  authorize(){return true;},
  async effect(_member,input){
   try{
    const client=await flightMutationClient();
    const result=await client.rpc('submit_flight_interest',{p_flight_id:input.flightId,p_introductory_note:input.introductoryNote??''}).retry(false);
    if(result.error?.code==='42501')return {code:'forbidden',message:'Access denied.'};
    if(result.error?.code==='22023')return {code:'invalid_input',message:'Choose a valid flight and an introduction of at most 500 characters.'};
    if(result.error)return unavailable;
    const data=result.data;
    if(!data||typeof data!=='object'||Array.isArray(data))return unavailable;
    if(data.code==='flight_unavailable')return {code:'flight_unavailable',message:'This flight is unavailable for new interest.'};
    if(data.code==='request_closed')return {code:'request_closed',message:'This request is closed and cannot be submitted again.'};
    if(typeof data.requestId!=='string'||!uuid.test(data.requestId))return unavailable;
    if(data.code==='submitted'&&data.status==='pending')return {code:'submitted',requestId:data.requestId,status:'pending'};
    if(data.code==='already_requested'&&(data.status==='pending'||data.status==='accepted'))return {code:'already_requested',requestId:data.requestId,status:data.status};
    return unavailable;
   }catch{return unavailable;}
  },
 };
}
