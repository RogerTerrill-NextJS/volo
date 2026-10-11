import type {ProfileField,ProfileFieldErrors,ProfileFields} from './validation';

export type ProfileFormState={revision:number;values:Partial<Record<ProfileField,string>>;fieldErrors:ProfileFieldErrors;message:string|null;reload:boolean;saved?:boolean};
const fields=['display_name','home_airport','pilot_designation','certificates','ratings','aircraft_access','flying_interests','bio'] as const;

export function profileFormValues(profile:ProfileFields):ProfileFormState['values']{
 return Object.fromEntries(fields.map(field=>[field,Array.isArray(profile[field])?profile[field].join('\n'):profile[field]??'']));
}

export function profileFailureState(previous:ProfileFormState,form:FormData,result:{code:string;message?:string;fieldErrors?:ProfileFieldErrors}):ProfileFormState{
 const values:ProfileFormState['values']={};
 // Echo only bounded permitted fields, never identity or action metadata.
 for(const key of fields){const value=form.get(key);if(typeof value==='string')values[key]=[...value].slice(0,4000).join('');}
 return {revision:(Number.isSafeInteger(previous?.revision)?previous.revision:0)+1,values,
  fieldErrors:result.fieldErrors??{},message:result.message??'Unable to save your profile.',saved:false,
  reload:result.code==='conflict'||result.code==='unavailable'||result.code==='internal_error'};
}
