export type InterestFormState={revision:number;status:'editing'|'pending'|'accepted'|'closed'|'unconfirmed'|'denied'|'profile_required'|'flight_unavailable';note:string;message:string|null};
export const emptyInterestForm:InterestFormState={revision:0,status:'editing',note:'',message:null};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function interestFormResult(previous:InterestFormState,form:FormData,result:{code:string;status?:string;requestId?:string}):InterestFormState{
 const revision=Number.isSafeInteger(previous?.revision)&&previous.revision>=0&&previous.revision<1000000?previous.revision+1:1;
 const confirmed=typeof result.requestId==='string'&&uuid.test(result.requestId);
 if(confirmed&&((result.code==='submitted'&&result.status==='pending')||(result.code==='already_requested'&&['pending','accepted'].includes(result.status??'')))){
  const status=result.status==='accepted'?'accepted':'pending';
  return {revision,status,note:'',message:status==='accepted'?'Your request has been accepted.':'Request pending. The posting pilot will review your interest.'};
 }
 const raw=form.get('introductory_note'),note=typeof raw==='string'?[...raw].slice(0,500).join(''):'';
 const status=result.code==='request_closed'?'closed':result.code==='flight_unavailable'?'flight_unavailable':result.code==='profile_required'?'profile_required'
  :['unauthenticated','forbidden'].includes(result.code)?'denied':['invalid_input','too_large'].includes(result.code)?'editing':'unconfirmed';
 const message={closed:'This request is closed and cannot be submitted again.',flight_unavailable:'This flight is unavailable for new interest. It may be full or no longer open.',profile_required:'Complete your pilot profile before requesting a flight.',denied:'Your access could not be verified. Reload this flight before trying again.',editing:'Check your introduction. Use no more than 500 characters.',unconfirmed:'Unable to confirm your request. Check request status before submitting again.'}[status];
 return {revision,status,note,message};
}
