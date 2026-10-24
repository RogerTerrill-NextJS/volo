import type {CancellationResult} from './cancellation-mutation.ts';
import {parseCancellationInput} from './cancellation-input.ts';
export type CancellationFormState={revision:number;status:'ready'|'cancelled'|'stale'|'denied'|'unconfirmed';message:string|null};
export const emptyCancellationForm:CancellationFormState={revision:0,status:'ready',message:null};
export function cancellationFormResult(previous:CancellationFormState,form:FormData,result:CancellationResult):CancellationFormState{
 const revision=Number.isSafeInteger(previous?.revision)&&previous.revision>=0&&previous.revision<1000000?previous.revision+1:1;
 const input=parseCancellationInput({flight_id:form.get('flight_id'),intent:form.get('intent'),confirmation:form.get('confirmation')});
 if(input&&(result.code==='cancelled'||result.code==='already_cancelled')&&result.flightId===input.flightId&&result.status==='cancelled')return {revision,status:'cancelled',message:'Flight cancelled. Pending and accepted requests are closed; flight and request history are retained.'};
 const status=['flight_conflict','invalid_input','too_large'].includes(result.code)?'stale':['forbidden','unauthenticated'].includes(result.code)?'denied':'unconfirmed';
 return {revision,status,message:{stale:'This flight has changed or the confirmation was incomplete. Check flight status before trying again.',denied:'Your access could not be verified. Check flight status before trying again.',unconfirmed:'Unable to confirm cancellation. Check flight status before trying again.'}[status]};
}
