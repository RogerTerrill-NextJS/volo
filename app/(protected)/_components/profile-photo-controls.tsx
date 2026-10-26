'use client';
import {useId,useRef,useState} from 'react';
import {createBrowserSupabaseClient} from '../../../lib/supabase/client';
import {photoRequest,uploadProfilePhoto} from '../../../lib/profiles/photo-client';
import ProfilePhoto from './profile-photo';

const button='rounded-lg border border-zinc-300 px-4 py-3 font-medium focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-60';
export default function ProfilePhotoControls({userId,displayName,initialAvailable}:{userId:string;displayName:string;initialAvailable:boolean}){
 const id=useId(),fileInput=useRef<HTMLInputElement>(null),feedback=useRef<HTMLParagraphElement>(null),running=useRef(false);
 const [file,setFile]=useState<File|null>(null),[busy,setBusy]=useState<'upload'|'remove'|null>(null),[available,setAvailable]=useState(initialAvailable),[revision,setRevision]=useState(0);
 const [message,setMessage]=useState(''),[failed,setFailed]=useState(false);
 async function change(mode:'upload'|'remove'){
  if(running.current||mode==='upload'&&!file)return;
  running.current=true;setBusy(mode);setFailed(false);setMessage(mode==='upload'?'Uploading and checking your photo…':'Removing your photo…');
  try{
   let pending:boolean;
   if(mode==='upload'){
    const client=createBrowserSupabaseClient({fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.any([AbortSignal.timeout(30000),...(init?.signal?[init.signal]:[])])})});
    try{pending=(await uploadProfilePhoto(userId,file!,async(path,file)=>client.storage.from('profile-photo-uploads').upload(path,file,{contentType:file.type,upsert:false,cacheControl:'0'}))).cleanupPending;}
    finally{await client.auth.dispose().catch(()=>{});}
   }else{
    const result=await photoRequest('remove');
    if(result?.code!=='removed'||typeof result.cleanupPending!=='boolean')throw new Error('We could not confirm the photo change. Check your current photo before trying again.');
    pending=result.cleanupPending;
   }
   setAvailable(mode==='upload');setRevision(value=>value+1);setFile(null);if(fileInput.current)fileInput.current.value='';
   setMessage(`${mode==='upload'?'Photo saved.':'Photo removed.'}${pending?' Old files are still being cleaned up.':''}`);
  }catch(error){setFailed(true);setMessage(error instanceof Error?error.message:'Your photo could not be changed. Try again later.');}
  finally{running.current=false;setBusy(null);feedback.current?.focus();}
 }
 return <section aria-labelledby={`${id}-heading`} aria-busy={Boolean(busy)} className="max-w-xl space-y-4 rounded-2xl border border-zinc-200 p-6">
  <h2 id={`${id}-heading`} className="text-xl font-semibold">Profile photo (optional)</h2>
  <ProfilePhoto key={revision} userId={userId} displayName={displayName} available={available} revision={revision}/>
  <p id={`${id}-help`} className="text-sm text-zinc-600">Choose a JPEG, PNG or WebP image up to 5 MB. Animated images are not supported. Only active members can view your photo.</p>
  <label htmlFor={`${id}-file`} className="block text-sm font-medium">{available?'Choose a replacement photo':'Choose a photo'}</label>
  <input ref={fileInput} id={`${id}-file`} type="file" accept="image/jpeg,image/png,image/webp" aria-describedby={`${id}-help`} disabled={Boolean(busy)} onChange={event=>setFile(event.target.files?.[0]??null)} className="block max-w-full text-sm file:mr-3 file:rounded-lg file:border file:border-zinc-300 file:bg-transparent file:px-4 file:py-3 file:text-inherit focus-visible:outline-2 focus-visible:outline-offset-4"/>
  <div className="flex flex-wrap gap-3">
   <button type="button" disabled={Boolean(busy)||!file} onClick={()=>void change('upload')} className={button}>{busy==='upload'?'Saving photo…':available?'Replace photo':'Upload photo'}</button>
   {available&&<button type="button" disabled={Boolean(busy)} onClick={()=>void change('remove')} className={button}>{busy==='remove'?'Removing photo…':'Remove photo'}</button>}
   {failed&&<button type="button" disabled={Boolean(busy)} onClick={()=>{setAvailable(true);setRevision(value=>value+1);}} className={button}>Check current photo</button>}
  </div>
  <p ref={feedback} tabIndex={-1} role={failed?'alert':'status'} aria-live="polite" className="text-sm empty:hidden">{message}</p>
  <noscript><p className="text-sm">Enable JavaScript to change your photo. You can still edit your profile details below.</p></noscript>
 </section>;
}
