import 'server-only';
import {createServerSupabaseClient} from '../supabase/server';

/** Session-scoped ordinary operations; bound request AND body, never retry writes. */
export async function flightMutationClient(){
 const deadline=AbortSignal.timeout(5000);
 return createServerSupabaseClient({cookieMode:'read-only',fetch:async(url,init)=>{
  const response=await fetch(url,{...init,signal:init?.signal?AbortSignal.any([deadline,init.signal]):deadline,cache:'no-store',redirect:'error'});
  return new Response(await response.text(),{status:response.status,headers:response.headers});
 }});
}
