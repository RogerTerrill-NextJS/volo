import 'server-only';
import {createServerSupabaseClient} from '../supabase/server';
import type {ActiveMember} from '../auth/access';

/** Call after a fresh access check; read only the current member's profile ID. */
export async function getOwnProfileStatus(member:ActiveMember):Promise<'missing'|'complete'|'unavailable'> {
 try{
  const signal=AbortSignal.timeout(5000);
  const client=await createServerSupabaseClient({cookieMode:'read-only',fetch:async(url,init)=>{
   const response=await fetch(url,{...init,signal:init?.signal?AbortSignal.any([signal,init.signal]):signal,cache:'no-store',redirect:'error'});
   return new Response(await response.text(),{status:response.status,headers:response.headers});
  }});
  const {data,error}=await client.from('profiles').select('user_id').eq('user_id',member.userId).retry(false).maybeSingle();
  if(error)return 'unavailable';
  // Required profile fields are enforced by the schema; no draft rows exist.
  if(data===null)return 'missing';
  return data.user_id===member.userId?'complete':'unavailable';
 }catch{return 'unavailable';}
}
