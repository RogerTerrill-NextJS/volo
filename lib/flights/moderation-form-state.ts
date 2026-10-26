import {memberAdminUuid,memberAdminTime} from '../auth/member-admin-validation.ts';
export type ModerationFormState={revision:number;status:'ready'|'invalid'|'hidden'|'denied'|'unconfirmed';reason:string;message:string|null};
export const emptyModerationForm:ModerationFormState={revision:0,status:'ready',reason:'',message:null};
export function moderationFormResult(previous:ModerationFormState,form:FormData,outcome:unknown):ModerationFormState{
 const revision=(Number.isSafeInteger(previous?.revision)?previous.revision:0)+1,raw=form.get('reason'),reason=typeof raw==='string'?raw.replace(/\r\n?/g,'\n').trim().slice(0,2000):'';
 const result=outcome&&typeof outcome==='object'&&!Array.isArray(outcome)?outcome as Record<string,unknown>:{},target=form.get('flight_id');
 if((result.code==='hidden'||result.code==='already_hidden')&&typeof target==='string'&&memberAdminUuid.test(target.toLowerCase())&&result.flightId===target.toLowerCase()&&memberAdminTime(result.moderatedAt)&&(result.status==='cancelled'||result.status==='completed')&&form.get('confirmation')==='hide')return {revision,status:'hidden',reason:'',message:result.code==='already_hidden'?'This flight is already hidden. No new audit event was added.':'Flight hidden. Active requests are closed and further messages cannot be sent.'};
 const status=['forbidden','unauthenticated','flight_unavailable'].includes(String(result.code))?'denied':['invalid_input','too_large'].includes(String(result.code))?'invalid':'unconfirmed';
 const message={denied:'Hiding is not available for this account or flight. Check flight status before continuing.',invalid:'Enter a reason with 1–500 characters and confirm the hide.',unconfirmed:'We could not confirm whether this flight was hidden. Check flight status before trying again.'}[status];
 return {revision,status,reason,message};
}
