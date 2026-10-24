import type {InterestFormState} from './interest-form-state.ts';
import type {WithdrawalResult} from './withdrawal-mutation.ts';
import {parseWithdrawalInput} from './withdrawal-input.ts';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function withdrawalFormResult(previous:InterestFormState,form:FormData,result:WithdrawalResult):InterestFormState{
 const revision=Number.isSafeInteger(previous?.revision)&&previous.revision>=0&&previous.revision<1000000?previous.revision+1:1;
 const input=parseWithdrawalInput({flight_id:form.get('flight_id'),intent:form.get('intent')});
 if(input&&(result.code==='withdrawn'||result.code==='already_withdrawn')&&result.flightId===input.flightId&&typeof result.requestId==='string'&&uuid.test(result.requestId)&&result.status==='withdrawn')return {revision,status:'withdrawn',note:'',message:'Request withdrawn. You can submit interest again if this flight is still eligible.'};
 const status=['request_conflict','request_unavailable','invalid_input','too_large'].includes(result.code)?'stale':['forbidden','unauthenticated'].includes(result.code)?'denied':'withdrawal_unconfirmed';
 return {revision,status,note:'',message:{stale:'This request has changed. Check request status before taking another action.',denied:'Your access could not be verified. Check request status before trying again.',withdrawal_unconfirmed:'Unable to confirm your withdrawal. Check request status before taking another action.'}[status]};
}
