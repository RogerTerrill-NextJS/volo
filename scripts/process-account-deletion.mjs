// Operator-only. Never import into an app/client bundle. Tokens are environment-only.
import {createClient} from '@supabase/supabase-js';
import {deletionId,runDeletionStep} from '../lib/deletion/runner.mjs';
import {getSupabasePrivilegedConfig} from '../lib/supabase/privileged-config.mjs';
import {getSupabasePublicConfig} from '../lib/supabase/public-config.mjs';
import {cleanupProfilePhotos} from '../lib/profiles/photo-cleanup.ts';
const options={};const args=process.argv.slice(2);
for(let i=0;i<args.length;i++){
 const key=args[i];if(!['--request','--subject','--reference','--confirm','--execute'].includes(key)||key in options)throw Error('Invalid deletion arguments');
 options[key]=key==='--execute'?true:args[++i];
}
if(!deletionId(options['--request'])||(options['--subject']&&(!deletionId(options['--subject'])||options['--confirm']!==options['--subject']||typeof options['--reference']!=='string'||options['--reference'].trim().length<1||options['--reference'].length>160))||(!options['--subject']&&(options['--confirm']||options['--reference'])))throw Error('Use --request UUID; new verified requests also need --subject UUID --confirm SAME_UUID --reference VERIFIED_REFERENCE');
try{
 const {url,publishableKey}=getSupabasePublicConfig();
 const token=process.env.VOLO_DELETION_ADMIN_ACCESS_TOKEN;
 if(!token)throw Error();
 const client=createClient(url,publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:'Bearer '+token},fetch:(input,init)=>fetch(input,{...init,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)})}});
 if((await client.auth.getUser(token)).error)throw Error();
 const rpc=async(name,input)=>{const r=await client.rpc(name,input).retry(false);if(r.error||!r.data)throw Error('Deletion step unavailable');return r.data;};
 const request=options['--request'];
 if(options['--subject']){
  const preview=await rpc('admin_account_deletion_preview',{p_subject_id:options['--subject']});
  if(!options['--execute']){console.log(JSON.stringify({code:'confirmation_required',impact:preview}));process.exitCode=0;}
  else console.log(JSON.stringify(await rpc('admin_begin_account_deletion',{p_request_id:request,p_subject_id:options['--subject'],p_reference:options['--reference'],p_confirmation:options['--confirm']})));
 }else if(!options['--execute']){
  const s=await rpc('admin_account_deletion_status',{p_request_id:request});
  console.log(JSON.stringify({phase:s.phase,ready:s.ready,photoPending:s.photoPending,purgeDueAt:s.purgeDueAt,overdue:s.overdue}));
 }else{
  // Read the guarded receipt before creating a privileged client or external effect.
  await rpc('admin_account_deletion_status',{p_request_id:request});
  const {secretKey}=getSupabasePrivilegedConfig();
  const service=createClient(url,secretKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch(input,{...init,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)})}});
  const checked=async result=>{if(result.error)throw Error('Deletion external step pending');return result.data;};
  const result=await runDeletionStep(request,{
   status:id=>rpc('admin_account_deletion_status',{p_request_id:id}),
   prepare:id=>rpc('admin_prepare_account_deletion',{p_request_id:id}),
   cleanup:id=>cleanupProfilePhotos(20,{ownerId:id}),
   removeObjects:async(bucket,paths)=>checked(await service.storage.from(bucket).remove(paths)),
   finishPhotos:id=>rpc('admin_finish_deletion_photos',{p_request_id:id}),
   authUser:async id=>(await checked(await service.auth.admin.getUserById(id))).user,
   deleteAuth:async id=>checked(await service.auth.admin.deleteUser(id,true)),
   complete:id=>rpc('admin_complete_account_deletion',{p_request_id:id}),
  });
  console.log(JSON.stringify(result));
 }
}catch{console.error('Deletion operation unavailable or pending. Inspect the guarded receipt with the same request ID; no automatic retry was performed.');process.exitCode=1;}
