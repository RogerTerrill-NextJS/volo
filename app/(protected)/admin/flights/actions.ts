'use server';
import {refresh} from 'next/cache';
import {hideFlight} from '../../../../lib/flights/moderation-actions';
import {moderationFormResult,type ModerationFormState} from '../../../../lib/flights/moderation-form-state';
export async function hideAdminFlight(previous:ModerationFormState,form:FormData):Promise<ModerationFormState>{
 const state=moderationFormResult(previous,form,await hideFlight(null,form));
 if(state.status==='hidden')refresh();
 return state;
}
