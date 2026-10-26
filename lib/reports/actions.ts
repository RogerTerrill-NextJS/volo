'use server';
import {handleActionMutation} from '../auth/action-mutation';
import {reportPolicy} from './mutation';
export async function submitReport(_previous:unknown,form:FormData){
 const result=await handleActionMutation(form,reportPolicy(),12288);
 return result.ok?result.data:{code:result.code,message:result.message};
}
