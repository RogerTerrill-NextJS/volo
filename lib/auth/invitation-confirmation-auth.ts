import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {VerifiedConfirmation} from './invitation-confirmation-store.ts';
import {getSupabasePublicConfig} from '../supabase/public-config.mjs';
import {invitationEmail,invitationUuid} from './invitation-send.ts';
export async function verifyConfirmationSession(client:{auth:Pick<SupabaseClient['auth'],'getClaims'|'getUser'>},token?:string):Promise<{code:'verified';identity:VerifiedConfirmation}|{code:'denied'|'unavailable'}>{
 try{
  const claims=await client.auth.getClaims(token);if(claims.error||!claims.data)return {code:'denied'};
  const c=claims.data.claims,{url}=getSupabasePublicConfig();
  if(typeof c.sub!=='string'||!invitationUuid.test(c.sub)||typeof c.session_id!=='string'||!invitationUuid.test(c.session_id)
   ||c.iss!==url+'/auth/v1'||c.aud!=='authenticated'||typeof c.exp!=='number'||c.exp<=Date.now()/1000||c.is_anonymous!==false)return {code:'denied'};
  const user=await client.auth.getUser(token),u=user.data.user;
  if(user.error||!u||u.id!==c.sub||u.is_anonymous!==false||!u.email||!invitationEmail(u.email)||!u.email_confirmed_at)return {code:'denied'};
  return {code:'verified',identity:{subject:u.id,email:u.email,sessionId:c.session_id}};
 }catch{return {code:'unavailable'};}
}
/** One request-owned deadline includes bodies; terminal 400 prevents SDK retries. */
export function createConfirmationAuthTransport(){
 const controller=new AbortController();let unavailable=false;
 const timer=setTimeout(()=>{unavailable=true;controller.abort();},5000);
 const terminal=()=>Response.json({code:'volo_confirmation_unavailable',message:'Confirmation unavailable.'},{status:400});
 return {isUnavailable:()=>unavailable,close(){clearTimeout(timer);controller.abort();},fetch:(async(input,init)=>{
  if(unavailable||controller.signal.aborted)return terminal();
  try{
   const response=await fetch(input,{...init,signal:controller.signal,cache:'no-store',redirect:'error'});
   if(response.status===429||response.status>=500){void response.body?.cancel();unavailable=true;return terminal();}
   const text=await response.text();if(controller.signal.aborted)throw new Error();const data=JSON.parse(text);
   if(!response.ok){const code=typeof data?.code==='string'?data.code:data?.error_code;
    if(!['otp_expired','bad_jwt','session_not_found','user_not_found','user_banned','validation_failed'].includes(code)){unavailable=true;return terminal();}
    return Response.json({code,message:'Confirmation rejected.'},{status:response.status});
   }
   const url=new URL(input instanceof Request?input.url:String(input));
   if(url.pathname.endsWith('/verify')&&(!data.user?.id||!data.access_token||!data.refresh_token))throw new Error();
   return new Response(text,{status:response.status,headers:response.headers});
  }catch{unavailable=true;return terminal();}
 }) satisfies typeof fetch};
}
