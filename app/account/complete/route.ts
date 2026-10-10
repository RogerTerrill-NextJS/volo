import {randomUUID} from 'node:crypto';
import {NextResponse,type NextRequest} from 'next/server';
import {applyPrivateResponseHeaders} from '../../../lib/http/private-response.ts';
import {checkMutationOrigin} from '../../../lib/auth/mutation-request.ts';
import {parseMutationOrigin} from '../../../lib/auth/mutation-origin.mjs';
import {confirmationCookieNames} from '../../../lib/auth/invitation-setup.ts';
import {confirmationDigest,isConfirmationSecret} from '../../../lib/auth/invitation-confirmation-crypto.ts';
import {readCompletionInput,completionCsrf} from '../../../lib/auth/invitation-completion-input.ts';
import {createConfirmationStore} from '../../../lib/auth/invitation-confirmation-store.ts';
import {createConfirmationAuthTransport,verifyConfirmationSession} from '../../../lib/auth/invitation-confirmation-auth.ts';
import {createCompletionAuthTransport,setInvitationPassword} from '../../../lib/auth/invitation-completion-auth.ts';
import {completeInvitedAccount} from '../../../lib/auth/invitation-completion.ts';
import {readInvitationEligibility} from '../../../lib/auth/invitation-eligibility.ts';
import {getAccess} from '../../../lib/auth/access.ts';
import {createServerSupabaseClient} from '../../../lib/supabase/server.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
function privateHeaders(){const h=new Headers();applyPrivateResponseHeaders(h);h.set('Referrer-Policy','no-referrer');return h;}
export async function POST(request:NextRequest){
 const headers=privateHeaders();let origin:string|undefined;let verification:ReturnType<typeof createConfirmationAuthTransport>|undefined,mutation:ReturnType<typeof createCompletionAuthTransport>|undefined;
 const redirect=(result:string)=>new NextResponse(null,{status:303,headers:new Headers([...headers,['Location',origin?new URL('/account/setup?result='+result,origin).href:'/account/setup?result='+result]])});
 try{
  origin=parseMutationOrigin(process.env.VOLO_MUTATION_ORIGIN??'',true);
  if(checkMutationOrigin(new Headers(request.headers),origin)!==null)return new NextResponse(null,{status:403,headers});
  if(request.nextUrl.search)return redirect('invalid_input');
  const input=await readCompletionInput(request),names=confirmationCookieNames(origin),cookie=request.cookies.get(names.setup)?.value;
  if(!input||!isConfirmationSecret(cookie)||input.csrf!==completionCsrf(cookie))return redirect('invalid_input');
  const sink=(updates:Record<string,string>)=>{for(const [key,value] of Object.entries(updates))headers.set(key,value);applyPrivateResponseHeaders(headers);headers.set('Referrer-Policy','no-referrer');};
  verification=createConfirmationAuthTransport();
  const initial=await createServerSupabaseClient({cookieMode:'read-write',fetch:verification.fetch,setResponseHeaders:sink});
  const verified=await verifyConfirmationSession(initial);
  if(verification.isUnavailable()||verified.code==='unavailable')return redirect('retry_later');
  if(verified.code!=='verified')return redirect('access_denied');
  verification.close();
  let passwordClient:Awaited<ReturnType<typeof createServerSupabaseClient>>|undefined;
  const result=await completeInvitedAccount({setupDigest:confirmationDigest(cookie),identity:verified.identity,origin,password:input.password},{
   store:createConfirmationStore(),newOperationId:randomUUID,eligible:readInvitationEligibility,access:getAccess,
   async setPassword(password){
    mutation=createCompletionAuthTransport();
    passwordClient=await createServerSupabaseClient({cookieMode:'read-write',fetch:mutation.fetch,setResponseHeaders:sink});
    return setInvitationPassword(passwordClient,password,verified.identity.subject,mutation);
   },
   async verifyIdentity(){
    if(!passwordClient||!mutation)return {code:'unavailable'};
    const identity=await verifyConfirmationSession(passwordClient);return mutation.isUnavailable()?{code:'unavailable'}:identity;
   },
  });
  if(result.code!=='completed')return redirect(result.code==='renew_required'?'renew_invitation':result.code);
  const response=new NextResponse(null,{status:303,headers});response.headers.set('Location',new URL('/dashboard',origin).href);
  response.cookies.set(names.setup,'',{path:'/',httpOnly:true,secure:names.secure,sameSite:'lax',maxAge:0});return response;
 }catch{return redirect('retry_later');}finally{verification?.close();mutation?.close();}
}
function unsupported(){return new NextResponse(null,{status:405,headers:{...Object.fromEntries(privateHeaders()),Allow:'POST'}});}
export const GET=unsupported,HEAD=unsupported,PUT=unsupported,DELETE=unsupported,PATCH=unsupported,OPTIONS=unsupported;
