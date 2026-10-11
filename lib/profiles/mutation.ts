import 'server-only';
import type {MutationPolicy} from '../auth/mutation';
import {createServerSupabaseClient} from '../supabase/server';
import {validateProfile,type ProfileValidation,type ProfileFieldErrors} from './validation.ts';

export type ProfileSaveResult = {code:'saved'}|{code:'invalid_input';message:string;fieldErrors:ProfileFieldErrors}|{code:'conflict'|'unavailable';message:string};
const unavailable:ProfileSaveResult={code:'unavailable',message:'Unable to confirm the save. Reload your profile before trying again.'};

/** Mode comes from the server action; neither identity nor mode is a form field. */
export function profileSavePolicy(mode:'create'|'update'):MutationPolicy<ProfileValidation,ProfileSaveResult> {
  return {
    allowedRoles:['member','admin'],
    // Keep field feedback inside the guarded result so invalid fields never cause a write.
    parse(raw){return {ok:true,value:validateProfile(raw)};},
    authorize(){return true;},
    async effect(member,input){
      if(!input.ok)return {code:'invalid_input',message:input.message,fieldErrors:input.fieldErrors};
      try{
        const signal=AbortSignal.timeout(5000);
        const client=await createServerSupabaseClient({cookieMode:'read-only',fetch:async(url,init)=>{
          const response=await fetch(url,{...init,signal:init?.signal?AbortSignal.any([signal,init.signal]):signal,cache:'no-store',redirect:'error'});
          // Include the response body in the deadline, rather than timing only headers.
          return new Response(await response.text(),{status:response.status,headers:response.headers});
        }});
        // Explicit INSERT/UPDATE: upsert would require a prohibited identity INSERT grant.
        const query=mode==='create'
          ?client.from('profiles').insert(input.value)
          :client.from('profiles').update(input.value).eq('user_id',member.userId);
        const result=await query.select('user_id').retry(false).maybeSingle();
        if(result.error){
          if(mode==='create'&&result.error.code==='23505')return {code:'conflict',message:'A profile already exists. Reload your profile before trying again.'};
          return unavailable;
        }
        if(result.data===null)return {code:'conflict',message:'Your profile could not be saved. Reload your profile before trying again.'};
        if(result.data.user_id!==member.userId)return unavailable;
        return {code:'saved'};
      }catch{return unavailable;}
    },
  };
}
