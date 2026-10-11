import 'server-only';
import {photoServiceClient} from './photo-service.ts';
import {deletePhotoObject} from './photo-storage.ts';

export async function cleanupProfilePhotos(limit=20):Promise<{deleted:number;pending:number}>{
 if(!Number.isInteger(limit)||limit<1||limit>20)throw new Error('Invalid cleanup batch');
 const client=photoServiceClient();const claims=await client.rpc('claim_profile_photo_cleanup',{batch_size:limit}).retry(false);
 if(claims.error||!claims.data)throw new Error('Photo cleanup unavailable');
 let deleted=0,pending=0;
 for(const claim of claims.data){
  let source=false,final=false;
  try{source=claim.source_path===null||await deletePhotoObject('profile-photo-uploads',claim.source_path);}catch{}
  try{final=claim.final_path===null||await deletePhotoObject('profile-photos',claim.final_path);}catch{}
  const ack=await client.rpc('ack_profile_photo_cleanup',{reservation_id:claim.id,claim_token:claim.claim_token,source_deleted:source,final_deleted:final}).retry(false);
  if(source&&final&&!ack.error&&ack.data&&typeof ack.data==='object'&&!Array.isArray(ack.data)&&ack.data.code==='acknowledged')deleted++;else pending++;
 }
 return {deleted,pending};
}
