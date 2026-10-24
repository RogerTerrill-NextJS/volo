import {flightFormResult,type FlightFormState} from './form-state.ts';
import type {EditResult} from './edit-mutation.ts';
import {normalizeEditInstant} from './edit-input.ts';
export function editFormResult(previous:FlightFormState,form:FormData,result:EditResult):FlightFormState{
 const saved=flightFormResult(previous,form,{code:'invalid_input',fieldErrors:result.code==='invalid_input'?result.fieldErrors:{}});
 const flightId=form.get('flight_id'),expectedUpdatedAt=normalizeEditInstant(form.get('expected_updated_at'));
 if((result.code==='updated'||result.code==='already_updated')&&typeof flightId==='string'&&result.flightId===flightId.toLowerCase()&&normalizeEditInstant(result.updatedAt))return {...saved,status:'updated',values:{},fieldErrors:{},message:'Flight updated.',flightId:result.flightId};
 const stale:Record<string,string>={flight_conflict:'This flight changed after you opened the form. Reload the current flight before editing again.',capacity_conflict:'Accepted participants changed. Reload this flight to check the available capacity.',repost_required:'This flight has accepted pilots. Cancel and repost it to change the route, time, timezone or aircraft.',flight_unavailable:'This flight is no longer available for editing. Reload its current status.'};
 const status=stale[result.code]?'stale':['unauthenticated','forbidden','profile_required'].includes(result.code)?'denied':['invalid_input','too_large'].includes(result.code)?'editing':'unconfirmed';
 return {...saved,status,...(expectedUpdatedAt?{expectedUpdatedAt}:{}),message:stale[result.code]??(status==='unconfirmed'?'Unable to confirm your edit. Check the current flight before saving again.':status==='denied'?'Your owner access or pilot profile could not be verified. Reload this flight before editing.':result.code==='too_large'?'Shorten the aircraft description or notes.':'Check the highlighted flight fields.')};
}
