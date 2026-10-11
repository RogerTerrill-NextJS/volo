import 'server-only';
import {createClient} from '@supabase/supabase-js';
import type {Database} from '../supabase/database.types';
import {getSupabasePrivilegedConfig} from '../supabase/privileged-config.mjs';

/** Photo lifecycle operations only; lazy config keeps ordinary builds secret-free. */
export function photoServiceClient({signal:budget}:{signal?:AbortSignal}={}){
 const {url,secretKey}=getSupabasePrivilegedConfig();
 return createClient<Database>(url,secretKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,init)=>{
  const signal=AbortSignal.any([AbortSignal.timeout(10000),...(budget?[budget]:[])]);
  const response=await fetch(input,{...init,signal:init?.signal?AbortSignal.any([signal,init.signal]):signal,cache:'no-store',redirect:'error'});
  return new Response(await response.text(),{status:response.status,headers:response.headers});
 }}});
}
