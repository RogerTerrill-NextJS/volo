import 'server-only';
import {photoServiceClient} from './photo-service.ts';
import {deletePhotoObject} from './photo-storage.ts';

/** Inline callers scope to the owner and use two seconds; operators get forty.
 * Both budgets are shorter than the sixty-second claim lease. */
export async function cleanupProfilePhotos(limit=20,{ownerId,budgetMs=40000}:{ownerId?:string;budgetMs?:number}={}):Promise<{deleted:number;pending:number}>{
 if(!Number.isInteger(limit)||limit<1||limit>20||!Number.isInteger(budgetMs)||budgetMs<1||budgetMs>40000||
  (ownerId!==undefined&&!/^[a-f0-9-]{36}$/.test(ownerId)))throw new Error('Invalid cleanup batch');
 const signal=AbortSignal.timeout(budgetMs),client=photoServiceClient({signal});
 const claims=await client.rpc('claim_profile_photo_cleanup',{batch_size:limit,cleanup_owner:ownerId??undefined}).retry(false);
 if(claims.error||!claims.data)throw new Error('Photo cleanup unavailable');
 let deleted=0;
 for(const claim of claims.data){
  if(signal.aborted||Date.now()>=Date.parse(claim.lease_until)-1000)break;
  let source=false,final=false;
  try{source=claim.source_path===null||await deletePhotoObject('profile-photo-uploads',claim.source_path,signal);}catch{}
  if(signal.aborted)break;
  try{final=claim.final_path===null||await deletePhotoObject('profile-photos',claim.final_path,signal);}catch{}
  if(signal.aborted)break;
  const ack=await client.rpc('ack_profile_photo_cleanup',{reservation_id:claim.id,claim_token:claim.claim_token,source_deleted:source,final_deleted:final}).retry(false);
  if(source&&final&&!ack.error&&ack.data&&typeof ack.data==='object'&&!Array.isArray(ack.data)&&ack.data.code==='acknowledged')deleted++;
 }
 // A separate bounded read still works after the cleanup budget expired.
 // Include outstanding leases and work outside the selected batch.
 const pending=await photoServiceClient({signal:AbortSignal.timeout(1000)}).rpc('count_profile_photo_cleanup',{cleanup_owner:ownerId??undefined}).retry(false);
 if(pending.error||typeof pending.data!=='number'||!Number.isInteger(pending.data)||pending.data<0)throw new Error('Photo cleanup status unavailable');
 return {deleted,pending:pending.data};
}
