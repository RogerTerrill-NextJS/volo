'use server';
import {redirect} from 'next/navigation';
import {createProfile} from '../../../lib/profiles/actions';
import {profileFailureState,type ProfileFormState} from '../../../lib/profiles/form-state';

export type OnboardingState=ProfileFormState;

export async function completeProfile(previous:OnboardingState,form:FormData):Promise<OnboardingState>{
 const result=await createProfile(null,form);
 if(result.code==='saved')redirect('/dashboard?from=profile-onboarding');
 return profileFailureState(previous,form,result);
}
