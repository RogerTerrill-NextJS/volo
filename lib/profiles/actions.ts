'use server';
import {handleActionMutation} from '../auth/action-mutation';
import {profileSavePolicy} from './mutation';

/** Form callers receive safe feedback; the existing guard supplies fresh identity. */
export async function createProfile(_previous:unknown,form:FormData){
  const result=await handleActionMutation(form,profileSavePolicy('create'),32768);
  return result.ok?result.data:{code:result.code,message:result.message};
}

export async function updateProfile(_previous:unknown,form:FormData){
  const result=await handleActionMutation(form,profileSavePolicy('update'),32768);
  return result.ok?result.data:{code:result.code,message:result.message};
}
