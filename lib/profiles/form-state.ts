import type {ProfileField,ProfileFieldErrors,ProfileFields} from './validation';

type CredentialField='certificates'|'ratings';
type ProfileFormValues=Partial<Record<Exclude<ProfileField,CredentialField>,string>>&Partial<Record<CredentialField,string[]>>;
export type ProfileFormState={revision:number;values:ProfileFormValues;fieldErrors:ProfileFieldErrors;message:string|null;reload:boolean;saved?:boolean};
const fields=['display_name','home_airport','pilot_designation','certificates','ratings','aircraft_access','flying_interests','bio'] as const;

export function profileFormValues(profile:ProfileFields):ProfileFormState['values']{
 return Object.fromEntries(fields.map(field=>[field,profile[field]??'']));
}

/** New checkbox fields carry JSON strings so native CR/LF normalization is lossless.
 * Old textarea callers retain their existing newline-delimited contract. */
export function profileInput(raw:unknown):unknown{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return raw;
 const input={...raw} as Record<string,unknown>;
 for(const field of ['certificates','ratings'] as const){
  const key=`${field}[]`;
  if(!Object.hasOwn(input,key))continue;
  // Reject conflicting old/new representations instead of choosing one silently.
  if(Object.hasOwn(input,field))return raw;
  const encoded=input[key];
  try{
   input[field]=typeof encoded==='string'?encoded.split('\n').map(value=>JSON.parse(value)):null;
  }catch{input[field]=null;}
  delete input[key];
 }
 return input;
}

export function profileFormInput(form:FormData):Record<string,unknown>{
 const raw:Record<string,unknown>=Object.fromEntries([...form].filter(([key])=>!key.startsWith('$ACTION_')));
 for(const field of ['certificates[]','ratings[]']){
  const entries=form.getAll(field);
  if(entries.length)raw[field]=entries.every(entry=>typeof entry==='string')?entries.join('\n'):null;
 }
 return profileInput(raw) as Record<string,unknown>;
}

export function profileFailureState(previous:ProfileFormState,form:FormData,result:{code:string;message?:string;fieldErrors?:ProfileFieldErrors}):ProfileFormState{
 const values:ProfileFormState['values']={};
 // Echo only bounded permitted fields, never identity or action metadata.
 const raw=profileFormInput(form);
 for(const key of fields){
  const value=raw[key];
  if(key==='certificates'||key==='ratings'){
   const labels=Array.isArray(value)?value:typeof value==='string'?(value.trim()?value.split(/\r\n|\r|\n/):[]):[];
   values[key]=labels.filter((entry):entry is string=>typeof entry==='string').slice(0,21).map(entry=>[...entry].slice(0,80).join(''));
  }else if(typeof value==='string')values[key]=[...value].slice(0,4000).join('');
 }
 return {revision:(Number.isSafeInteger(previous?.revision)?previous.revision:0)+1,values,
  fieldErrors:result.fieldErrors??{},message:result.message??'Unable to save your profile.',saved:false,
  reload:result.code==='conflict'||result.code==='unavailable'||result.code==='internal_error'};
}
