'use server';
import {refresh} from 'next/cache';
import {handleActionMutation} from '../../../lib/auth/action-mutation';
import {notificationReadPolicy} from '../../../lib/notifications/mutation';
export async function markNotificationRead(_previous:unknown,form:FormData){
 const result=await handleActionMutation(form,notificationReadPolicy(),4096);
 const state=result.ok?result.data:{code:result.code};
 if(state.code==='read')refresh();
 return state;
}
