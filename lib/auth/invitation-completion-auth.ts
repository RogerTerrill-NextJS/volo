import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import {invitationEmail,invitationUuid} from './invitation-send.ts';
const passwordRejections=new Set(['weak_password','same_password']);
/** One request-owned, body-inclusive deadline; terminal errors prevent SDK retries. */
export function createCompletionAuthTransport(){
 const controller=new AbortController();let unavailable=false;
 const timer=setTimeout(()=>{unavailable=true;controller.abort();},5000);
 const terminal=()=>Response.json({code:'volo_completion_unavailable',error_code:'volo_completion_unavailable',message:'Account completion unavailable.'},{status:400});
 return {isUnavailable:()=>unavailable,close(){clearTimeout(timer);controller.abort();},fetch:(async(input,init)=>{
  if(unavailable||controller.signal.aborted)return terminal();
  try{
   const response=await fetch(input,{...init,signal:controller.signal,cache:'no-store',redirect:'error'});
   if(response.status===429||response.status>=500){void response.body?.cancel();unavailable=true;return terminal();}
   const text=await response.text();if(controller.signal.aborted)throw new Error();const data=JSON.parse(text);
   if(!response.ok){
    const code=typeof data?.code==='string'?data.code:data?.error_code;
    if(!passwordRejections.has(code)||![400,422].includes(response.status)){unavailable=true;return terminal();}
    return Response.json({code,error_code:code,message:'Password rejected.'},{status:response.status});
   }
   return new Response(text,{status:response.status,headers:response.headers});
  }catch{unavailable=true;return terminal();}
 }) satisfies typeof fetch};
}
export async function setInvitationPassword(client:{auth:Pick<SupabaseClient['auth'],'updateUser'>},password:string,expectedSubject:string,transport:ReturnType<typeof createCompletionAuthTransport>):Promise<{code:'updated'|'rejected'|'unknown'}>{
 try{
  const result=await client.auth.updateUser({password});
  if(transport.isUnavailable())return {code:'unknown'};
  if(result.error)return {code:passwordRejections.has(result.error.code??'')?'rejected':'unknown'};
  const u=result.data.user;
  if(!u||u.id!==expectedSubject||!invitationUuid.test(u.id)||!invitationEmail(u.email)||u.is_anonymous!==false||!u.email_confirmed_at||u.aud!=='authenticated'||!u.created_at||!u.app_metadata||!u.user_metadata)return {code:'unknown'};
  return {code:'updated'};
 }catch{return {code:'unknown'};}
}
