'use server';
import {handleActionMutation} from '../../../../../lib/auth/action-mutation';
import {interestSubmissionPolicy} from '../../../../../lib/flights/interest-mutation';
import {interestFormResult,type InterestFormState} from '../../../../../lib/flights/interest-form-state';
export async function requestInterest(previous:InterestFormState,form:FormData):Promise<InterestFormState>{
 const outcome=await handleActionMutation(form,interestSubmissionPolicy(),4096);
 const result=outcome.ok?outcome.data:{code:outcome.code};
 return interestFormResult(previous,form,result);
}
