import type {Database} from '../supabase/database.types';

export type ProfileFields = Pick<Database['public']['Tables']['profiles']['Insert'],
  'display_name'|'home_airport'|'pilot_designation'|'certificates'|'ratings'|'aircraft_access'|'flying_interests'|'bio'> & {
  pilot_designation:'licensed';certificates:string[];ratings:string[];aircraft_access:string|null;flying_interests:string|null;bio:string|null;
};
export type ProfileField = keyof ProfileFields;
export type ProfileFieldErrors = Partial<Record<ProfileField,string>>;
export type ProfileValidation = {ok:true;value:ProfileFields}|{ok:false;fieldErrors:ProfileFieldErrors;message:string};
const fields:readonly ProfileField[]=['display_name','home_airport','pilot_designation','certificates','ratings','aircraft_access','flying_interests','bio'];
const message='Check the highlighted profile fields.';
const validText=(value:unknown):value is string=>typeof value==='string'&&value.isWellFormed()&&!value.includes('\u0000');
const length=(value:string)=>[...value].length;

/** Shared by browser feedback and server saves; returns only permitted normalized fields. */
export function validateProfile(raw:unknown):ProfileValidation {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!fields.includes(key as ProfileField))) {
    return {ok:false,fieldErrors:{},message:'The profile contains unsupported fields.'};
  }
  const input=raw as Record<string,unknown>,fieldErrors:ProfileFieldErrors={};
  const name=validText(input.display_name)?input.display_name.trim():'';
  if(!name||length(name)>80)fieldErrors.display_name='Enter a display name of 1–80 characters.';
  const airport=validText(input.home_airport)?input.home_airport.trim().toUpperCase():'';
  if(!/^[A-Z0-9]{2,8}$/.test(airport))fieldErrors.home_airport='Enter a home airport identifier of 2–8 letters or numbers.';
  const designation=input.pilot_designation;
  if(designation!=='licensed')fieldErrors.pilot_designation='Confirm that you are a licensed pilot to create or update your profile.';

  function labels(field:'certificates'|'ratings'):string[] {
    const raw=input[field];
    // Native forms use one label per line; array callers retain the same rules.
    const values=raw===undefined?[]:typeof raw==='string'?(raw.trim()?raw.split(/\r\n|\r|\n/):[]):raw;
    if(!Array.isArray(values)||values.length>20) {
      fieldErrors[field]='Enter at most 20 labels, each 1–80 characters.';return [];
    }
    const normalized:string[]=[];
    for(const entry of values) {
      if(!validText(entry)||!entry.trim()||length(entry.trim())>80) {
        fieldErrors[field]='Enter at most 20 labels, each 1–80 characters.';return [];
      }
      normalized.push(entry.trim());
    }
    return normalized;
  }
  function optional(field:'aircraft_access'|'flying_interests'|'bio',limit:number):string|null {
    const value=input[field];
    if(value===undefined||value===null)return null;
    if(!validText(value)||length(value.trim())>limit) {
      fieldErrors[field]=`Use at most ${limit.toLocaleString('en-US')} characters.`;return null;
    }
    return value.trim()||null;
  }
  const certificates=labels('certificates'),ratings=labels('ratings');
  const aircraft_access=optional('aircraft_access',500),flying_interests=optional('flying_interests',500),bio=optional('bio',2000);
  if(Object.keys(fieldErrors).length)return {ok:false,fieldErrors,message};
  return {ok:true,value:{display_name:name,home_airport:airport,pilot_designation:designation as ProfileFields['pilot_designation'],certificates,ratings,aircraft_access,flying_interests,bio}};
}
