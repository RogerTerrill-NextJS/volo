import 'server-only';
import {createServerSupabaseClient} from '../supabase/server';

/** Only a current conversation participant can obtain this history label. */
export async function conversationHasDeletedPilot(id:string):Promise<boolean>{
 try{
  const client=await createServerSupabaseClient({cookieMode:'read-only'});
  const result=await client.rpc('conversation_has_deleted_pilot',{p_conversation_id:id}).retry(false);
  return !result.error&&result.data===true;
 }catch{return false;}
}

/** A request's actual owner/requester only, including history without a thread. */
export async function requestHasDeletedPilot(id:string):Promise<boolean>{
 try{
  const client=await createServerSupabaseClient({cookieMode:'read-only'});
  const result=await client.rpc('request_has_deleted_pilot',{p_request_id:id}).retry(false);
  return !result.error&&result.data===true;
 }catch{return false;}
}
