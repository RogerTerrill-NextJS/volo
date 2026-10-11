import 'server-only';
import {getAccess} from '../auth/access';
import {createServerSupabaseClient} from '../supabase/server';
import {applyPrivateResponseHeaders} from '../http/private-response';
import {readProfilePhoto} from './photo-image';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function response(status:number,bytes?:Uint8Array){
 const headers=new Headers();applyPrivateResponseHeaders(headers);
 headers.set('X-Content-Type-Options','nosniff');
 if(bytes)headers.set('Content-Type','image/webp');
 return new Response(bytes?Buffer.from(bytes):null,{status,headers});
}

/** Resolve only a current profile pointer, then let session Storage RLS recheck access. */
export async function readCurrentProfilePhoto(userId:string):Promise<Response>{
 const access=await getAccess();
 if(access.status!=='authorized')return response(access.status==='unauthenticated'?401:access.status==='forbidden'?403:503);
 if(!uuid.test(userId))return response(404);
 try{
  const signal=AbortSignal.timeout(10000);
  const client=await createServerSupabaseClient({cookieMode:'read-only',fetch:async(input,init)=>{
   const result=await fetch(input,{...init,signal:init?.signal?AbortSignal.any([signal,init.signal]):signal,cache:'no-store',redirect:'error'});
   if(new URL(String(input)).pathname.startsWith('/storage/v1/object/')&&result.ok){
    if(result.headers.get('content-type')?.split(';')[0].trim()!=='image/webp')throw new Error('Photo unavailable');
    return new Response(Buffer.from(await readProfilePhoto(result)),{status:result.status,headers:result.headers});
   }
   return new Response(await result.text(),{status:result.status,headers:result.headers});
  }});
  const result=await client.from('profiles').select('user_id,photo_storage_path').eq('user_id',userId).retry(false).maybeSingle();
  if(result.error)return response(503);
  const key=result.data?.photo_storage_path;
  if(result.data?.user_id!==userId||typeof key!=='string'||!key.startsWith(userId+'/')||!uuid.test(key.slice(userId.length+1,-5))||!key.endsWith('.webp'))return response(404);
  const image=await client.storage.from('profile-photos').download(key);
  if(image.error)return response(String('statusCode' in image.error?image.error.statusCode:'')==='404'?404:503);
  if(!image.data||image.data.size===0||image.data.size>5_000_000)return response(503);
  return response(200,new Uint8Array(await image.data.arrayBuffer()));
 }catch{return response(503);}
}
