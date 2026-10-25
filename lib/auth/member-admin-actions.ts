'use server';
import {handleActionMutation} from './action-mutation';
import {memberDisablePolicy} from './member-admin-mutation';
export async function disableMember(_previous:unknown,form:FormData){
 const result=await handleActionMutation(form,memberDisablePolicy(),4096);
 return result.ok?result.data:{code:result.code,message:result.message};
}
