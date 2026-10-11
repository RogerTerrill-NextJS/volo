'use server';
import {updateProfile} from '../../../../lib/profiles/actions';
import {profileFailureState,profileFormValues,type ProfileFormState} from '../../../../lib/profiles/form-state';
import {validateProfile} from '../../../../lib/profiles/validation';

export async function saveProfile(previous:ProfileFormState,form:FormData):Promise<ProfileFormState>{
 const result=await updateProfile(null,form);
 if(result.code!=='saved')return profileFailureState(previous,form,result);
 const raw=Object.fromEntries([...form].filter(([key])=>!key.startsWith('$ACTION_')));
 const validated=validateProfile(raw);
 // The guarded update has already validated these fields and confirmed ownership.
 if(!validated.ok)return profileFailureState(previous,form,{code:'internal_error'});
 return {revision:(Number.isSafeInteger(previous?.revision)?previous.revision:0)+1,
  values:profileFormValues(validated.value),fieldErrors:{},message:'Profile saved.',reload:false,saved:true};
}
