'use server';
import {handleActionMutation} from '../auth/action-mutation';
import {flightModerationPolicy} from './moderation-mutation';
export async function hideFlight(_previous:unknown,form:FormData){
 const result=await handleActionMutation(form,flightModerationPolicy(),4096);
 return result.ok?result.data:{code:result.code,message:result.message};
}
