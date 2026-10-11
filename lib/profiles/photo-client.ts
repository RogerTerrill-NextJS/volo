export type PhotoUpload=(path:string,file:File)=>Promise<{error:unknown}>;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
class PhotoFeedback extends Error {}
const unavailable=()=>new PhotoFeedback('We could not confirm the photo change. Check your current photo before trying again.');
export async function photoRequest(mode:'reserve'|'finalize'|'remove',reservationId?:string,request:typeof fetch=fetch){
 try{
  const response=await request(mode==='reserve'?'/api/profile/photo/uploads':'/api/profile/photo',{
   method:mode==='remove'?'DELETE':'POST',credentials:'same-origin',cache:'no-store',
   headers:mode==='remove'?{}:{'content-type':'application/json'},
   body:mode==='remove'?undefined:JSON.stringify(mode==='reserve'?{}:{reservation_id:reservationId}),
   signal:AbortSignal.timeout(45000),
  });
  const result=await response.json();
  if(!response.ok||!result.ok){
   const code=result.code;
   if(code==='invalid_image')throw new PhotoFeedback('Choose a valid, non-animated JPEG, PNG or WebP image up to 5 MB.');
   if(['unauthenticated','forbidden','profile_required'].includes(code))throw new PhotoFeedback('Your access changed. Sign in and reload your profile before trying again.');
   if(code==='limited')throw new PhotoFeedback('An earlier upload is still pending. Wait a few minutes before trying again.');
   if(code==='conflict')throw new PhotoFeedback('Your photo changed in another request. Check your current photo before trying again.');
   throw unavailable();
  }
  return result.data;
 }catch(error){
  if(error instanceof PhotoFeedback)throw error;
  throw unavailable();
 }
}
export async function uploadProfilePhoto(ownerId:string,file:File,upload:PhotoUpload,request:typeof fetch=fetch):Promise<{cleanupPending:boolean}>{
 if(file.size===0||file.size>5_000_000||!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Choose a JPEG, PNG or WebP image up to 5 MB.');
 const reservation=await photoRequest('reserve',undefined,request);
 if(reservation?.code!=='reserved'||typeof reservation.reservationId!=='string'||!uuid.test(reservation.reservationId)||reservation.sourcePath!==`${ownerId}/${reservation.reservationId}/source`)throw unavailable();
 try{const result=await upload(reservation.sourcePath,file);if(result.error)throw new Error();}
 catch{throw new Error('The upload did not finish. Your current photo is unchanged. Try again later.');}
 const result=await photoRequest('finalize',reservation.reservationId,request);
 if(result?.code!=='saved'||typeof result.cleanupPending!=='boolean')throw unavailable();
 return {cleanupPending:result.cleanupPending};
}
