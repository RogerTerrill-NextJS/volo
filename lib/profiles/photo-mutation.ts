import 'server-only';
import {createServerSupabaseClient} from '../supabase/server';
import type {MutationPolicy} from '../auth/mutation';
import {photoServiceClient} from './photo-service.ts';
import {downloadReservedPhoto,uploadNormalizedPhoto} from './photo-storage.ts';
import {normalizeProfilePhoto,InvalidProfilePhoto} from './photo-image.ts';
import {cleanupProfilePhotos} from './photo-cleanup.ts';

type Input={reservation_id?:string};
export type PhotoResult={code:'reserved';reservationId:string;sourcePath:string}|{code:'saved'|'removed';cleanupPending:boolean}|{code:'invalid_image'|'conflict'|'limited'|'forbidden'|'unavailable'};
type RpcResult={code:string;id?:string;source_path?:string;final_path?:string};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function rpcData(value:unknown):RpcResult {if(!value||typeof value!=='object'||!('code' in value)||typeof value.code!=='string')throw new Error('Photo result unavailable');return value as RpcResult;}
function failure(code:string):PhotoResult{return {code:['conflict','limited','forbidden'].includes(code)?code as 'conflict'|'limited'|'forbidden':'unavailable'};}
async function cleanupPending(){try{return (await cleanupProfilePhotos()).pending>0;}catch{return true;}}
export function profilePhotoPolicy(mode:'reserve'|'finalize'|'remove'):MutationPolicy<Input,PhotoResult>{return {
 allowedRoles:['member','admin'],requireCompleteProfile:true,
 parse(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return {ok:false};
  const input=value as Input,keys=Object.keys(value);
  if(mode==='finalize')return keys.length===1&&keys[0]==='reservation_id'&&typeof input.reservation_id==='string'&&uuid.test(input.reservation_id)?{ok:true,value:input}:{ok:false};
  return keys.length===0?{ok:true,value:{}}:{ok:false};
 },authorize(){return true;},
 async effect(member,input){
  let reservation:string|undefined;
  try{
   const client=await createServerSupabaseClient({cookieMode:'read-only',fetch:async(url,init)=>{
    const deadline=AbortSignal.timeout(10000);const response=await fetch(url,{...init,signal:init?.signal?AbortSignal.any([deadline,init.signal]):deadline,cache:'no-store',redirect:'error'});
    return new Response(await response.text(),{status:response.status,headers:response.headers});
   }});
   if(mode==='reserve'){
    const result=await client.rpc('reserve_profile_photo').retry(false);if(result.error)return {code:'unavailable'};
    const data=rpcData(result.data);if(data.code!=='reserved')return failure(data.code);
    if(!data.id||!uuid.test(data.id)||data.source_path!==`${member.userId}/${data.id}/source`)return {code:'unavailable'};
    return {code:'reserved',reservationId:data.id,sourcePath:data.source_path};
   }
   if(mode==='remove'){
    const result=await client.rpc('remove_profile_photo').retry(false);if(result.error)return {code:'unavailable'};
    const data=rpcData(result.data);return data.code==='removed'?{code:'removed',cleanupPending:await cleanupPending()}:failure(data.code);
   }
   const begin=await client.rpc('begin_profile_photo_finalize',{reservation_id:input.reservation_id!}).retry(false);
   if(begin.error)return {code:'unavailable'};const data=rpcData(begin.data);if(data.code!=='processing')return failure(data.code);
   if(data.id!==input.reservation_id||data.source_path!==`${member.userId}/${data.id}/source`||data.final_path!==`${member.userId}/${data.id}.webp`)return {code:'unavailable'};
   reservation=input.reservation_id!;
   const download=await downloadReservedPhoto(data.source_path);
   const image=await normalizeProfilePhoto(download.bytes,download.mime);
   await uploadNormalizedPhoto(data.final_path,image);
   const service=photoServiceClient();const ready=await service.rpc('mark_profile_photo_ready',{reservation_id:reservation}).retry(false);
   if(ready.error||rpcData(ready.data).code!=='ready')throw new Error('Photo finalization unavailable');
   const attach=await client.rpc('attach_profile_photo',{reservation_id:reservation}).retry(false);
   if(!attach.error){const result=rpcData(attach.data);if(result.code==='saved')return {code:'saved',cleanupPending:await cleanupPending()};}
   // Observe both pointer and row after an uncertain response; never delete current.
   const current=await service.from('profiles').select('photo_storage_path').eq('user_id',member.userId).retry(false).maybeSingle();
   if(!current.error&&current.data?.photo_storage_path===data.final_path)return {code:'saved',cleanupPending:await cleanupPending()};
   await service.rpc('abandon_profile_photo',{reservation_id:reservation}).retry(false);await cleanupPending();
   return attach.error?{code:'unavailable'}:failure(rpcData(attach.data).code);
  }catch(error){
   if(reservation){try{await photoServiceClient().rpc('abandon_profile_photo',{reservation_id:reservation}).retry(false);await cleanupPending();}catch{}}
   return {code:error instanceof InvalidProfilePhoto?'invalid_image':'unavailable'};
  }
 }
};}
