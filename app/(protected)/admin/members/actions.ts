'use server';
import {refresh} from 'next/cache';
import {disableMember} from '../../../../lib/auth/member-admin-actions';
import {memberDisableFormResult,type MemberDisableFormState} from '../../../../lib/auth/member-admin-form-state';
export async function disableAdminMember(previous:MemberDisableFormState,form:FormData):Promise<MemberDisableFormState>{
 const state=memberDisableFormResult(previous,form,await disableMember(null,form));
 if(state.status==='disabled')refresh();
 return state;
}
