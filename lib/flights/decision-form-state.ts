import type {DecisionResult} from './decision-mutation.ts';
import {parseDecisionInput} from './decision-input.ts';
export type DecisionFormState={revision:number;status:'ready'|'accepted'|'declined'|'full'|'stale'|'unconfirmed'|'denied';message:string|null};
export const emptyDecisionForm:DecisionFormState={revision:0,status:'ready',message:null};
export function decisionFormResult(previous:DecisionFormState,form:FormData,result:DecisionResult):DecisionFormState{
 const revision=Number.isSafeInteger(previous?.revision)&&previous.revision>=0&&previous.revision<1000000?previous.revision+1:1;
 const input=parseDecisionInput({flight_id:form.get('flight_id'),request_id:form.get('request_id'),decision:form.get('decision')});
 if(input&&(result.code==='decided'||result.code==='already_decided')&&result.requestId===input.requestId&&result.status===input.decision)return {revision,status:input.decision,message:input.decision==='accepted'?'Request accepted.':'Request declined.'};
 const status=result.code==='capacity_full'?'full':['request_conflict','request_unavailable','request_ineligible','invalid_input','too_large'].includes(result.code)?'stale':['forbidden','unauthenticated'].includes(result.code)?'denied':'unconfirmed';
 const message={full:'This flight is full. This request is still pending. You can decline it or check request status.',stale:'This request or flight has changed. Check request status before deciding again.',denied:'Your owner access could not be verified. Reload this flight before trying again.',unconfirmed:'Unable to confirm your decision. Check request status before deciding again.'}[status];
 return {revision,status,message};
}
