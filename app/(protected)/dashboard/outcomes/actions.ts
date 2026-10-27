'use server';
import {handleActionMutation} from '../../../../lib/auth/action-mutation';
import {outcomePolicy} from '../../../../lib/outcomes/mutation';
import {outcomeFormResult,type OutcomeFormState} from '../../../../lib/outcomes/form-state';
export async function saveOutcome(previous:OutcomeFormState,form:FormData):Promise<OutcomeFormState>{
 const result=await handleActionMutation(form,outcomePolicy(),1024);
 return outcomeFormResult(previous,form,result.ok?result.data:result);
}
