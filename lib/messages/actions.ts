'use server';
import {handleActionMutation} from '../auth/action-mutation';
import {messageSendPolicy} from './send-mutation';
/** Every native/fetched action independently verifies origin, session and input. */
export async function sendMessage(_previous:unknown,form:FormData){
 const result=await handleActionMutation(form,messageSendPolicy(),20000);
 return result.ok?result.data:{code:result.code,message:result.message};
}
