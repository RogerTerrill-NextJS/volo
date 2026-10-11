import 'server-only';
import {getSupabasePrivilegedConfig} from '../supabase/privileged-config.mjs';
import {readProfilePhoto} from './photo-image.ts';

const source=/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/source$/;
const final=/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.webp$/;
function destination(bucket:'profile-photo-uploads'|'profile-photos',path:string){
 if(!(bucket==='profile-photo-uploads'?source:final).test(path))throw new Error('Invalid reserved photo path');
 const {url,secretKey}=getSupabasePrivilegedConfig();
 return {url:url+'/storage/v1/object/'+bucket+'/'+path,headers:{apikey:secretKey,Authorization:'Bearer '+secretKey}};
}
export async function downloadReservedPhoto(sourcePath:string){
 const {url,headers}=destination('profile-photo-uploads',sourcePath);
 const response=await fetch(url,{headers,signal:AbortSignal.timeout(10000),cache:'no-store',redirect:'error'});
 if(!response.ok)throw new Error('Photo download unavailable');
 const mime=response.headers.get('content-type')?.split(';')[0].trim()??'';
 return {bytes:await readProfilePhoto(response),mime};
}
export async function uploadNormalizedPhoto(finalPath:string,bytes:Uint8Array){
 const {url,headers}=destination('profile-photos',finalPath);
 const response=await fetch(url,{method:'POST',headers:{...headers,'content-type':'image/webp','x-upsert':'false'},body:Buffer.from(bytes),signal:AbortSignal.timeout(10000),cache:'no-store',redirect:'error'});
 await response.text();if(!response.ok)throw new Error('Photo upload unavailable');
}
export async function deletePhotoObject(bucket:'profile-photo-uploads'|'profile-photos',path:string):Promise<boolean>{
 const {url,headers}=destination(bucket,path);
 const response=await fetch(url.substring(0,url.lastIndexOf('/storage/v1/object/'))+'/storage/v1/object/'+bucket,{method:'DELETE',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({prefixes:[path]}),signal:AbortSignal.timeout(10000),cache:'no-store',redirect:'error'});
 await response.text();return response.ok;
}
