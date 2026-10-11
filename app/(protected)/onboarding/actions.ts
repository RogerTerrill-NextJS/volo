'use server';
import {redirect} from 'next/navigation';
import {createProfile} from '../../../lib/profiles/actions';
import type {ProfileField,ProfileFieldErrors} from '../../../lib/profiles/validation';

export type OnboardingState={revision:number;values:Partial<Record<ProfileField,string>>;fieldErrors:ProfileFieldErrors;message:string|null;reload:boolean};

export async function completeProfile(previous:OnboardingState,form:FormData):Promise<OnboardingState>{
 const result=await createProfile(null,form);
 if(result.code==='saved')redirect('/dashboard?from=profile-onboarding');
 const values:OnboardingState['values']={};
 // Echo only bounded, permitted profile fields, never identity or action metadata.
 for(const key of ['display_name','home_airport','pilot_designation','certificates','ratings','aircraft_access','flying_interests','bio'] as const){
  const value=form.get(key);if(typeof value==='string')values[key]=[...value].slice(0,4000).join('');
 }
 return {revision:(Number.isSafeInteger(previous?.revision)?previous.revision:0)+1,values,
  fieldErrors:'fieldErrors' in result?result.fieldErrors:{},message:result.message,
  reload:result.code==='conflict'||result.code==='unavailable'||result.code==='internal_error'};
}
