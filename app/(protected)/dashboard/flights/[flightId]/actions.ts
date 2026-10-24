'use server';
import {handleActionMutation} from '../../../../../lib/auth/action-mutation';
import {interestSubmissionPolicy} from '../../../../../lib/flights/interest-mutation';
import {interestFormResult,type InterestFormState} from '../../../../../lib/flights/interest-form-state';
import {decisionPolicy} from '../../../../../lib/flights/decision-mutation';
import {decisionFormResult,type DecisionFormState} from '../../../../../lib/flights/decision-form-state';
import {refresh} from 'next/cache';
import {withdrawalPolicy} from '../../../../../lib/flights/withdrawal-mutation';
import {withdrawalFormResult} from '../../../../../lib/flights/withdrawal-form-state';
import {cancellationPolicy} from '../../../../../lib/flights/cancellation-mutation';
import {cancellationFormResult,type CancellationFormState} from '../../../../../lib/flights/cancellation-form-state';
export async function cancelFlight(previous:CancellationFormState,form:FormData):Promise<CancellationFormState>{
 const outcome=await handleActionMutation(form,cancellationPolicy(),2048);
 const state=cancellationFormResult(previous,form,outcome.ok?outcome.data:{code:outcome.code});
 if(state.status==='cancelled')refresh();
 return state;
}
export async function requestInterest(previous:InterestFormState,form:FormData):Promise<InterestFormState>{
 if(form.get('intent')==='withdraw'){
  const outcome=await handleActionMutation(form,withdrawalPolicy(),2048);
  const state=withdrawalFormResult(previous,form,outcome.ok?outcome.data:{code:outcome.code});
  if(state.status==='withdrawn')refresh();
  return state;
 }
 const outcome=await handleActionMutation(form,interestSubmissionPolicy(),4096);
 const result=outcome.ok?outcome.data:{code:outcome.code};
 return interestFormResult(previous,form,result);
}
export async function decideRequest(previous:DecisionFormState,form:FormData):Promise<DecisionFormState>{
 const outcome=await handleActionMutation(form,decisionPolicy(),2048);
 const state=decisionFormResult(previous,form,outcome.ok?outcome.data:{code:outcome.code});
 if(state.status==='accepted'||state.status==='declined')refresh();
 return state;
}
