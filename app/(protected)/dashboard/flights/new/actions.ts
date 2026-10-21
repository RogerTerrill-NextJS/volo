'use server';
import {handleActionMutation} from '../../../../../lib/auth/action-mutation';
import {flightCreatePolicy} from '../../../../../lib/flights/mutation';
import {listRecipientCandidates} from '../../../../../lib/flights/recipient-query';
import {flightFormResult,type FlightFormState} from '../../../../../lib/flights/form-state';

export async function publishFlight(previous:FlightFormState,form:FormData):Promise<FlightFormState>{
 const outcome=await handleActionMutation(form,flightCreatePolicy(true),16384);
 const result=outcome.ok?outcome.data:{code:outcome.code,message:outcome.message};
 return flightFormResult(previous,form,result);
}

/** Directory query performs fresh membership checks before and after the read. */
export async function findRecipientCandidates(input:unknown){
 return listRecipientCandidates(input);
}
