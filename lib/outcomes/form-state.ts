import {messageUuid} from '../messages/validation.ts';
import {parseOutcome,projectOutcome} from './validation.ts';
export type OutcomeFormState={requestId:string|null;attempt:number;status:'ready'|'saved'|'invalid'|'recover';message:string|null};
export const emptyOutcomeForm:OutcomeFormState={requestId:null,attempt:0,status:'ready',message:null};
export function outcomeFormResult(previous:OutcomeFormState,form:FormData,raw:unknown):OutcomeFormState{
 const rawId=form.get('request_id'),requestId=typeof rawId==='string'&&messageUuid.test(rawId.toLowerCase())?rawId.toLowerCase():null;
 const attempt=(Number.isSafeInteger(previous?.attempt)?previous.attempt:0)+1;
 const input=parseOutcome({request_id:form.get('request_id'),answer:form.get('answer'),expected_revision:form.get('expected_revision')}),r=raw&&typeof raw==='object'?raw as Record<string,unknown>:{},outcome=projectOutcome(r.outcome);
 if(input&&r.code==='saved'&&outcome?.requestId===input.requestId&&outcome.answer===input.answer)return {requestId,attempt,status:'saved',message:'Your answer is saved. You can review or correct it after reloading.'};
 if(['invalid_input','too_large'].includes(String(r.code)))return {requestId,attempt,status:'invalid',message:'Choose Yes or No, then save your answer.'};
 return {requestId,attempt,status:'recover',message:r.code==='stale'?'Your answer changed in another tab. Check the latest answer before correcting it.':['outcome_unavailable','forbidden','unauthenticated'].includes(String(r.code))?'This outcome is no longer available. Check the current flight outcomes.':'We could not confirm whether your answer was saved. Check the latest answer before trying again.'};
}
