'use server';
import {refresh} from 'next/cache';
import {handleActionMutation} from '../../../../../../lib/auth/action-mutation';
import {flightEditPolicy} from '../../../../../../lib/flights/edit-mutation';
import {editFormResult} from '../../../../../../lib/flights/edit-form-state';
import type {FlightFormState} from '../../../../../../lib/flights/form-state';
export async function saveFlight(previous:FlightFormState,form:FormData):Promise<FlightFormState>{
 const outcome=await handleActionMutation(form,flightEditPolicy(),16384);
 const state=editFormResult(previous,form,outcome.ok?outcome.data:{code:outcome.code});
 if(state.status==='updated')refresh();
 return state;
}
