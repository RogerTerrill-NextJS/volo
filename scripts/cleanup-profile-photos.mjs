import {spawnSync} from 'node:child_process';

// server-only imports must run under Node's React server condition.
if(!process.execArgv.includes('--conditions=react-server')){
 const result=spawnSync(process.execPath,['--conditions=react-server',...process.argv.slice(1)],{stdio:'inherit'});
 process.exit(result.status??1);
}
const args=process.argv.slice(2),execute=args.includes('--execute');
const refIndex=args.indexOf('--project-ref');
if(refIndex<0||refIndex===args.length-1||args.length!==(execute?3:2)||!/^([a-z0-9]{20})$/.test(args[refIndex+1])||args.some((value,i)=>i!==refIndex&&i!==refIndex+1&&value!=='--execute'))throw new Error('Usage: node scripts/cleanup-profile-photos.mjs --project-ref REF [--execute]');
const expected=`https://${args[refIndex+1]}.supabase.co`;
if(process.env.NEXT_PUBLIC_SUPABASE_URL!==expected)throw new Error('Explicit project reference must match the configured Supabase URL');
try{
 if(execute){
  const {cleanupProfilePhotos}=await import('../lib/profiles/photo-cleanup.ts');
  const result=await cleanupProfilePhotos(20);console.log(JSON.stringify({mode:'execute',...result}));
 }else{
  const {photoServiceClient}=await import('../lib/profiles/photo-service.ts');
  const {data,error}=await photoServiceClient().from('profile_photo_objects').select('state,expires_at,processing_until,source_deleted,cleanup_until').retry(false).limit(1000);
  if(error||!data)throw new Error();
  const now=Date.now(),eligible=data.filter(r=>(!r.cleanup_until||Date.parse(r.cleanup_until)<=now)&&(['obsolete','cleaning'].includes(r.state)||(r.state==='current'&&!r.source_deleted)||(['pending','processing','ready'].includes(r.state)&&(Date.parse(r.expires_at)<=now||(r.processing_until&&Date.parse(r.processing_until)<=now))))).length;
  console.log(JSON.stringify({mode:'dry-run',eligibleInSample:eligible,sampled:data.length,batchLimit:20}));
 }
}catch{console.error('Profile photo cleanup unavailable; no provider details printed.');process.exitCode=1;}
