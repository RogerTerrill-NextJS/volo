import {memberAdminUuid,memberAdminTime} from './member-admin-validation.ts';
export type MemberDisableFormState={revision:number;status:'ready'|'invalid'|'disabled'|'denied'|'unconfirmed';reason:string;message:string|null;disabledAt:string|null};
export const emptyMemberDisableForm:MemberDisableFormState={revision:0,status:'ready',reason:'',message:null,disabledAt:null};
export function memberDisableFormResult(previous:MemberDisableFormState,form:FormData,outcome:unknown):MemberDisableFormState{
 const revision=(Number.isSafeInteger(previous?.revision)?previous.revision:0)+1,raw=form.get('reason'),reason=typeof raw==='string'?raw.replace(/\r\n?/g,'\n').trim().slice(0,2000):'';
 const result=outcome&&typeof outcome==='object'&&!Array.isArray(outcome)?outcome as Record<string,unknown>:{},target=form.get('target_id');
 if((result.code==='disabled'||result.code==='already_disabled')&&typeof target==='string'&&memberAdminUuid.test(target.toLowerCase())&&result.userId===target.toLowerCase()&&memberAdminTime(result.disabledAt)&&form.get('confirmation')==='disable')return {revision,status:'disabled',reason:'',message:result.code==='already_disabled'?'This member is already disabled. No new audit event was added.':'Member disabled. Their protected access has been revoked.',disabledAt:result.disabledAt};
 const status=['forbidden','unauthenticated','self_disable_not_allowed','member_unavailable'].includes(String(result.code))?'denied':['invalid_input','too_large'].includes(String(result.code))?'invalid':'unconfirmed';
 const message={denied:'Disabling is not available for this account or member. Check member status before continuing.',invalid:'Enter a reason with 1–500 characters and confirm the disable.',unconfirmed:'We could not confirm whether this member was disabled. Check member status before trying again.'}[status];
 return {revision,status,reason,message,disabledAt:null};
}
