const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function deletionId(value){return typeof value==='string'&&uuid.test(value);}
/** One bounded, resumable step. Every RPC independently verifies the current admin. */
export async function runDeletionStep(requestId,ports){
 if(!deletionId(requestId))throw Error('Invalid deletion request');
 requestId=requestId.toLowerCase();
 const status=await ports.status(requestId);
 if(!status||status.requestId!==requestId||!deletionId(status.subjectId)||!['closing','photos','auth','retention_pending','purged'].includes(status.phase))throw Error('Deletion status unavailable');
 const subject=status.subjectId;
 if(status.phase==='closing')return ports.prepare(requestId);
 if(status.phase==='photos'){
  if(status.ready!==true)return {code:'waiting_for_photo_drain'};
  await ports.cleanup(subject);
  const current=await ports.status(requestId);
  if(current.subjectId!==subject||current.phase!=='photos'||!Array.isArray(current.assets)||current.assets.length>20)throw Error('Deletion status changed');
  const grouped=new Map();
  for(const asset of current.assets){
   if(!asset||!['profile-photos','profile-photo-uploads'].includes(asset.bucket)||typeof asset.path!=='string'||!asset.path.startsWith(subject+'/')||asset.path.split('/').some(part=>!part||part==='.'||part==='..')||asset.path.includes('\\'))throw Error('Unsafe deletion asset');
   const paths=grouped.get(asset.bucket)??[];paths.push(asset.path);grouped.set(asset.bucket,paths);
  }
  for(const [bucket,paths] of grouped){await ports.status(requestId);await ports.removeObjects(bucket,paths);}
  return ports.finishPhotos(requestId);
 }
 if(status.phase==='auth'){
  const before=await ports.authUser(subject);
  if(!before||before.id!==subject)throw Error('Auth deletion status unavailable');
  if(!before.deleted_at){await ports.status(requestId);await ports.deleteAuth(subject);}
  const after=await ports.authUser(subject);
  if(!after||after.id!==subject||!after.deleted_at)throw Error('Auth deletion not confirmed');
  return ports.complete(requestId);
 }
 return {code:status.phase};
}
