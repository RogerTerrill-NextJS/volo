import {NextResponse,type NextRequest} from 'next/server';
import {cookies} from 'next/headers';
import {applyPrivateResponseHeaders} from '../../../lib/http/private-response.ts';
import {checkMutationOrigin} from '../../../lib/auth/mutation-request.ts';
import {parseMutationOrigin} from '../../../lib/auth/mutation-origin.mjs';
import {parseConfirmationLink,readConfirmationCsrf} from '../../../lib/auth/invitation-confirmation-input.ts';
import {createConfirmationStore} from '../../../lib/auth/invitation-confirmation-store.ts';
import {newConfirmationSecret,sealConfirmation,openConfirmation,confirmationDigest,isConfirmationSecret} from '../../../lib/auth/invitation-confirmation-crypto.ts';
import {createConfirmationTransport,acceptInvitationConfirmation,acceptRecoveryConfirmation,type TransportPorts} from '../../../lib/auth/invitation-confirmation.ts';
import {createConfirmationAuthTransport,verifyConfirmationSession} from '../../../lib/auth/invitation-confirmation-auth.ts';
import {confirmationCookieNames} from '../../../lib/auth/invitation-setup.ts';
import {createServerSupabaseClient} from '../../../lib/supabase/server.ts';
import {getSupabasePublicConfig} from '../../../lib/supabase/public-config.mjs';
import {readInvitationEligibility} from '../../../lib/auth/invitation-eligibility.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
function headers(){const h=new Headers();applyPrivateResponseHeaders(h);h.set('Referrer-Policy','no-referrer');h.set('Content-Security-Policy',"default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");h.set('X-Content-Type-Options','nosniff');return h;}
function message(status=200){return new NextResponse('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Account confirmation</title><main><h1>Account confirmation</h1><p>'+ (status===503?'Confirmation is temporarily unavailable. Try again later.':'This link cannot be used. Open a current account email or request a new password reset link.')+'</p></main></html>',{status,headers:{...Object.fromEntries(headers()),'Content-Type':'text/html; charset=utf-8'}});}
function ports():TransportPorts{return {store:createConfirmationStore(),newSecret:newConfirmationSecret,seal:sealConfirmation,open:openConfirmation,digest:confirmationDigest,now:Date.now};}
function trustedOrigin(){return parseMutationOrigin(process.env.VOLO_MUTATION_ORIGIN??'',true);}
function prefetch(request:NextRequest){return request.headers.has('next-router-prefetch')||/prefetch/i.test(request.headers.get('purpose')??'')||/prefetch/i.test(request.headers.get('sec-purpose')??'');}
export function HEAD(){return new NextResponse(null,{headers:headers()});}
export async function GET(request:NextRequest){
 try{
  if(prefetch(request))return HEAD();const origin=trustedOrigin(),names=confirmationCookieNames(origin),p=ports();
  if(request.nextUrl.search){
   const input=parseConfirmationLink(new URL(request.url));if(!input)return message(400);
   const created=await createConfirmationTransport({...input,origin,previousCookie:request.cookies.get(names.confirmation)?.value??null},p);
   if(created.code!=='created')return message(created.code==='unavailable'?503:429);
   const response=new NextResponse(null,{status:303,headers:headers()});response.headers.set('Location',new URL('/auth/confirm',origin).href);
   response.cookies.set(names.confirmation,created.cookie,{path:'/',httpOnly:true,secure:names.secure,sameSite:'lax',maxAge:600});return response;
  }
  const cookie=request.cookies.get(names.confirmation)?.value;if(!isConfirmationSecret(cookie))return message();
  const lookupDigest=confirmationDigest(cookie),stored=await p.store.read({lookupDigest,origin});if(stored.code!=='found')return message(stored.code==='unavailable'?503:400);
  const payload=openConfirmation(stored.envelope,{lookupDigest,origin,expiresAt:stored.envelope.expiresAt});if(!payload)return message(400);
  // CSRF is the only dynamic output; its canonical alphabet cannot contain HTML.
  const recovery=payload.flow==='recovery';
  return new NextResponse('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+ (recovery?'Confirm password reset':'Accept invitation')+'</title><main><h1>'+ (recovery?'Confirm password reset':'Accept invitation')+'</h1><p>'+ (recovery?'Continue to choose a new password.':'Continue to account setup. Invitations do not expire with age.')+'</p><form method="post" action="/auth/confirm"><input type="hidden" name="csrf" value="'+payload.csrf+'"><button type="submit">'+(recovery?'Confirm password reset':'Accept invitation')+'</button></form></main></html>',{headers:{...Object.fromEntries(headers()),'Content-Type':'text/html; charset=utf-8'}});

 }catch{return message(503);}
}
export async function POST(request:NextRequest){
 let transport:ReturnType<typeof createConfirmationAuthTransport>|undefined,wroteSession=false,claimed=false,names:ReturnType<typeof confirmationCookieNames>|undefined;
 const failure=async(status:number)=>{
  const response=message(status);if(!names)return response;
  if(claimed)response.cookies.set(names.confirmation,'',{path:'/',httpOnly:true,secure:names.secure,sameSite:'lax',maxAge:0});
  if(wroteSession){
   const store=await cookies(),base='sb-'+new URL(getSupabasePublicConfig().url).hostname.split('.')[0]+'-auth-token';
   for(const item of store.getAll())if(item.name===base||(item.name.startsWith(base+'.')&&/^\d+$/.test(item.name.slice(base.length+1))))store.set(item.name,'',{path:'/',maxAge:0,sameSite:'lax',secure:names.secure});
   response.cookies.set(names.setup,'',{path:'/',httpOnly:true,secure:names.secure,sameSite:'lax',maxAge:0});
   response.cookies.set(names.recovery,'',{path:'/',httpOnly:true,secure:names.secure,sameSite:'lax',maxAge:0});
  }
  return response;
 };
 try{
  const origin=trustedOrigin();if(request.nextUrl.search||checkMutationOrigin(new Headers(request.headers),origin)!==null)return message(403);
  const csrf=await readConfirmationCsrf(request);if(!csrf)return message(400);
  names=confirmationCookieNames(origin);const cookie=request.cookies.get(names.confirmation)?.value;if(!isConfirmationSecret(cookie))return message(400);
  const sdkHeaders=headers(),p=ports(),claim=p.store.claim;p.store.claim=async(input)=>{const result=await claim(input);if(result.code==='claimed')claimed=true;return result;};
  const lookupDigest=confirmationDigest(cookie),stored=await p.store.read({lookupDigest,origin});
  if(stored.code!=='found')return message(stored.code==='unavailable'?503:400);
  const payload=openConfirmation(stored.envelope,{lookupDigest,origin,expiresAt:stored.envelope.expiresAt});if(!payload)return message(400);
  const accept=payload.flow==='recovery'?acceptRecoveryConfirmation:acceptInvitationConfirmation;
  const result=await accept({cookie,csrf,origin},{...p,eligible:readInvitationEligibility,async verify(payload){
   transport=createConfirmationAuthTransport();
   const client=await createServerSupabaseClient({cookieMode:'read-write',fetch:transport.fetch,setResponseHeaders(updates){wroteSession=true;for(const [key,value] of Object.entries(updates))sdkHeaders.set(key,value);applyPrivateResponseHeaders(sdkHeaders);}});
   const verified=await client.auth.verifyOtp({token_hash:payload.tokenHash,type:payload.type});
   if(transport.isUnavailable())return {code:'unavailable'};if(verified.error||!verified.data.session)return {code:'denied'};
   const identity=await verifyConfirmationSession(client,verified.data.session.access_token);return transport.isUnavailable()?{code:'unavailable'}:identity;
  }});
  if(result.code!=='accepted'&&result.code!=='recovered')return await failure(result.code==='unavailable'?503:400);
  const response=new NextResponse(null,{status:303,headers:sdkHeaders});
  response.cookies.set(names.confirmation,'',{path:'/',httpOnly:true,secure:names.secure,sameSite:'lax',maxAge:0});
  if(result.code==='recovered'){
   response.headers.set('Location',new URL('/reset-password',origin).href);response.cookies.set(names.recovery,result.recoveryCookie,{path:'/',httpOnly:true,secure:names.secure,sameSite:'lax',maxAge:1800});
   response.cookies.set(names.setup,'',{path:'/',httpOnly:true,secure:names.secure,sameSite:'lax',maxAge:0});
  }else{
   response.headers.set('Location',new URL('/account/setup',origin).href);response.cookies.set(names.setup,result.setupCookie,{path:'/',httpOnly:true,secure:names.secure,sameSite:'lax',maxAge:1800});
   response.cookies.set(names.recovery,'',{path:'/',httpOnly:true,secure:names.secure,sameSite:'lax',maxAge:0});
  }
  return response;
 }catch{return await failure(503);}finally{transport?.close();}
}
function unsupported(){return new NextResponse(null,{status:405,headers:{...Object.fromEntries(headers()),Allow:'GET, HEAD, POST'}});}
export const PUT=unsupported,DELETE=unsupported,PATCH=unsupported,OPTIONS=unsupported;
