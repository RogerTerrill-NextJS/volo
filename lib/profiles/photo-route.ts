import 'server-only';
import {handleRouteMutation} from '../auth/route-mutation.ts';
import {runMutation} from '../auth/mutation.ts';
import {applyPrivateResponseHeaders} from '../http/private-response.ts';
import {profilePhotoPolicy,type PhotoResult} from './photo-mutation.ts';

export async function handlePhotoRoute(request:Request,mode:'reserve'|'finalize'|'remove'){
 let response:Response;
 if(mode==='remove'){
  const result=await runMutation(request.headers,async()=>{
   if(new URL(request.url).search){void request.body?.cancel().catch(()=>{});return null;}
   if(!request.body)return {};
   const reader=request.body.getReader();let timer:ReturnType<typeof setTimeout>|undefined;
   try{const first=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Body deadline')),5000);})]);return first.done?{}:null;}
   finally{clearTimeout(timer);void reader.cancel().catch(()=>{});}
  },profilePhotoPolicy(mode));
  const statuses={unauthenticated:401,forbidden:403,profile_required:403,unavailable:503,invalid_input:400,too_large:413,unsupported_media_type:415,unsupported_method:405,internal_error:500};
  response=Response.json(result,{status:result.ok?200:statuses[result.code]});
 }else{
  const policy=profilePhotoPolicy(mode);
  if(new URL(request.url).search)policy.parse=()=>({ok:false});
  response=await handleRouteMutation(request,{method:'POST',maxBytes:1024,policy});
 }
 const result=await response.json();
 if(result.ok){
  const status:Partial<Record<PhotoResult['code'],number>>={invalid_image:422,conflict:409,limited:429,forbidden:403,unavailable:503};
  const code=result.data.code as PhotoResult['code'];
  if(status[code])response=Response.json({ok:false,code},{status:status[code]});
  else response=Response.json(result,{status:200});
 }else response=Response.json(result,{status:response.status});
 applyPrivateResponseHeaders(response.headers);return response;
}
