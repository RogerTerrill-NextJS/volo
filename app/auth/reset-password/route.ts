import {NextResponse,type NextRequest} from 'next/server';
import {cookies} from 'next/headers';
import {applyPrivateResponseHeaders} from '../../../lib/http/private-response.ts';
import {checkMutationOrigin} from '../../../lib/auth/mutation-request.ts';
import {parseMutationOrigin} from '../../../lib/auth/mutation-origin.mjs';
import {confirmationCookieNames} from '../../../lib/auth/invitation-setup.ts';
import {confirmationDigest,isConfirmationSecret} from '../../../lib/auth/invitation-confirmation-crypto.ts';
import {readCompletionInput} from '../../../lib/auth/invitation-completion-input.ts';
import {resetCsrf} from '../../../lib/auth/password-reset.ts';
import {createConfirmationStore} from '../../../lib/auth/invitation-confirmation-store.ts';
import {createConfirmationAuthTransport,verifyConfirmationSession} from '../../../lib/auth/invitation-confirmation-auth.ts';
import {createCompletionAuthTransport,setInvitationPassword} from '../../../lib/auth/invitation-completion-auth.ts';
import {createProxyAuthTransport} from '../../../lib/supabase/proxy-auth.ts';
import {createServerSupabaseClient} from '../../../lib/supabase/server.ts';
import {getSupabasePublicConfig} from '../../../lib/supabase/public-config.mjs';
export const runtime='nodejs';
function privateHeaders(){const h=new Headers();applyPrivateResponseHeaders(h);h.set('Referrer-Policy','no-referrer');return h;}
export async function POST(request:NextRequest){
 const headers=privateHeaders();let origin:string;
 try{origin=parseMutationOrigin(process.env.VOLO_MUTATION_ORIGIN??'',true);}catch{return new NextResponse(null,{status:503,headers});}
 if(checkMutationOrigin(request.headers,origin)!==null)return new NextResponse(null,{status:403,headers});
 const names=confirmationCookieNames(origin);let consumed=false;
 const redirect=(result:'invalid_input'|'link_required'|'unavailable'|'password_reset')=>{
  const response=new NextResponse(null,{status:303,headers});
  response.headers.set('Location',new URL(result==='password_reset'?'/login?result=password_reset':'/reset-password?result='+result,origin).href);
  if(consumed)response.cookies.set(names.recovery,'',{path:'/',httpOnly:true,secure:names.secure,sameSite:'lax',maxAge:0});return response;
 };
 if(request.nextUrl.search)return redirect('invalid_input');
 const input=await readCompletionInput(request),cookie=request.cookies.get(names.recovery)?.value;
 if(!input)return redirect('invalid_input');
 if(!isConfirmationSecret(cookie)||input.csrf!==resetCsrf(cookie))return redirect('link_required');
 let verification:ReturnType<typeof createConfirmationAuthTransport>|undefined,mutation:ReturnType<typeof createCompletionAuthTransport>|undefined,logout:ReturnType<typeof createProxyAuthTransport>|undefined;
 const sink=(updates:Record<string,string>)=>{for(const [key,value] of Object.entries(updates))headers.set(key,value);applyPrivateResponseHeaders(headers);headers.set('Referrer-Policy','no-referrer');};
 try{
  verification=createConfirmationAuthTransport();const initial=await createServerSupabaseClient({cookieMode:'read-write',fetch:verification.fetch,setResponseHeaders:sink});
  const verified=await verifyConfirmationSession(initial);if(verification.isUnavailable()||verified.code==='unavailable')return redirect('unavailable');
  if(verified.code!=='verified')return redirect('link_required');verification.close();
  const claimed=await createConfirmationStore().recovery('claim',{digest:confirmationDigest(cookie),identity:verified.identity,origin});
  if(claimed.code!=='claimed')return redirect(claimed.code==='unavailable'?'unavailable':'link_required');
  // Consume before the external write. Even a lost committed response cannot
  // authorize another update; a new verified email is required to try again.
  consumed=true;mutation=createCompletionAuthTransport();
  const client=await createServerSupabaseClient({cookieMode:'read-write',fetch:mutation.fetch,setResponseHeaders:sink});
  const updated=await setInvitationPassword(client,input.password,verified.identity.subject,mutation);
  if(updated.code!=='updated')return redirect('link_required');mutation.close();
  // Success returns to fresh sign-in. Bounded local sign-out is best effort;
  // browser authority is removed even if provider revocation is unavailable.
  try{
   logout=createProxyAuthTransport();const signedOut=await createServerSupabaseClient({cookieMode:'read-write',fetch:logout.fetch,setResponseHeaders:sink});await signedOut.auth.signOut({scope:'local'});
  }catch{/* Password success is already verified; never repeat the update. */}
  finally{
   const store=await cookies(),base='sb-'+new URL(getSupabasePublicConfig().url).hostname.split('.')[0]+'-auth-token';
   for(const {name} of store.getAll())if(name===base||(name.startsWith(base)&&/^(?:\.\d+|-code-verifier(?:\.\d+)?|-flows-code-verifier(?:\.\d+)?|-flow-[A-Za-z0-9_-]+-code-verifier(?:\.\d+)?)$/.test(name.slice(base.length))))store.set(name,'',{path:'/',secure:names.secure,sameSite:'lax',httpOnly:true,maxAge:0});
   for(const name of [names.setup,names.confirmation,names.recovery])store.set(name,'',{path:'/',secure:names.secure,sameSite:'lax',httpOnly:true,maxAge:0});
  }
  return redirect('password_reset');
 }catch{return redirect(consumed?'link_required':'unavailable');}finally{verification?.close();mutation?.close();logout?.close();}
}
function unsupported(){return new NextResponse(null,{status:405,headers:{...Object.fromEntries(privateHeaders()),Allow:'POST'}});}
export const GET=unsupported,HEAD=unsupported,PUT=unsupported,DELETE=unsupported,PATCH=unsupported,OPTIONS=unsupported;
