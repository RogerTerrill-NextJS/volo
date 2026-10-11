import 'server-only';
import {createServerSupabaseClient} from '../supabase/server';
import type {ActiveMember} from '../auth/access';
import {validateProfile,type ProfileFields} from './validation';

async function profileReadClient(){
 const signal=AbortSignal.timeout(5000);
 return createServerSupabaseClient({cookieMode:'read-only',fetch:async(url,init)=>{
  const response=await fetch(url,{...init,signal:init?.signal?AbortSignal.any([signal,init.signal]):signal,cache:'no-store',redirect:'error'});
  return new Response(await response.text(),{status:response.status,headers:response.headers});
 }});
}

/** Call after a fresh access check; read only the current member's profile ID. */
export async function getOwnProfileStatus(member:ActiveMember):Promise<'missing'|'complete'|'unavailable'> {
 try{
  const client=await profileReadClient();
  const {data,error}=await client.from('profiles').select('user_id').eq('user_id',member.userId).retry(false).maybeSingle();
  if(error)return 'unavailable';
  // Required profile fields are enforced by the schema; no draft rows exist.
  if(data===null)return 'missing';
  return data.user_id===member.userId?'complete':'unavailable';
 }catch{return 'unavailable';}
}

/** Fresh active-member access must precede this owner-only read. */
export async function getOwnProfile(member:ActiveMember):Promise<{status:'complete';profile:ProfileFields;photoAvailable:boolean}|{status:'missing'|'unavailable'}>{
 try{
  const client=await profileReadClient();
  const {data,error}=await client.from('profiles').select('user_id,display_name,home_airport,pilot_designation,certificates,ratings,aircraft_access,flying_interests,bio,photo_storage_path').eq('user_id',member.userId).retry(false).maybeSingle();
  if(error)return {status:'unavailable'};
  if(data===null)return {status:'missing'};
  if(data.user_id!==member.userId)return {status:'unavailable'};
  const {user_id:owner,photo_storage_path:photo,...fields}=data;
  void owner;
  const result=validateProfile(fields);
  return result.ok?{status:'complete',profile:result.value,photoAvailable:typeof photo==='string'&&photo.length>0}:{status:'unavailable'};
 }catch{return {status:'unavailable'};}
}
