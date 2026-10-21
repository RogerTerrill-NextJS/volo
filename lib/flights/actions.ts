'use server';
import {handleActionMutation} from '../auth/action-mutation';
import {flightCreatePolicy} from './mutation';
import {recipientMutationPolicy} from './recipient-mutation';

/** Identity/ownership never comes from the form; result contains only safe feedback. */
export async function createFlight(_previous:unknown,form:FormData){
  const result=await handleActionMutation(form,flightCreatePolicy(),16384);
  return result.ok?result.data:{code:result.code,message:result.message};
}

export async function addFlightRecipient(_previous:unknown,form:FormData){
 const result=await handleActionMutation(form,recipientMutationPolicy(true),16384);
 return result.ok?result.data:{code:result.code,message:result.message};
}
export async function removeFlightRecipient(_previous:unknown,form:FormData){
 const result=await handleActionMutation(form,recipientMutationPolicy(false),16384);
 return result.ok?result.data:{code:result.code,message:result.message};
}
