import assert from 'node:assert/strict';
import {test} from 'node:test';
import {profileFailureState} from '../lib/profiles/form-state.ts';

test('failed saves retain every checkbox selection and omit unrelated fields',()=>{
 const form=new FormData();form.append('certificates[]',JSON.stringify('PPL-Private Pilot'));form.append('certificates[]',JSON.stringify('Glider'));
 form.append('ratings[]',JSON.stringify('IR-Instrument Rating'));form.append('ratings[]',JSON.stringify('MEI-Multi-Engine Instructor'));form.set('user_id','private-owner');
 const result=profileFailureState({revision:0,values:{},fieldErrors:{},message:null,reload:false},form,{code:'invalid_input'});
 assert.deepEqual(result.values.certificates,['PPL-Private Pilot','Glider']);
 assert.deepEqual(result.values.ratings,['IR-Instrument Rating','MEI-Multi-Engine Instructor']);
 assert.equal(Object.hasOwn(result.values,'user_id'),false);
});

test('legacy labels with embedded line breaks remain single values through edit and failed saves',async()=>{
 const {profileFormValues,profileFormInput}=await import('../lib/profiles/form-state.ts');
 const {credentialOptions}=await import('../lib/profiles/credentials.ts');
 const {validateProfile}=await import('../lib/profiles/validation.ts');
 const before={display_name:'Pilot',home_airport:'KPAO',pilot_designation:'licensed' as const,certificates:['Glider\nCommercial Pilot','Space\rPilot'],ratings:[],aircraft_access:null,flying_interests:null,bio:null};
 const values=profileFormValues(before);
 const options=credentialOptions('certificates',values.certificates??[]);
 assert.deepEqual(options.filter(option=>option.checked).map(option=>option.value),before.certificates);
 const form=new FormData();form.set('display_name','Pilot');form.set('home_airport','KPAO');form.set('pilot_designation','licensed');
 for(const option of options.filter(option=>option.checked))form.append('certificates[]',JSON.stringify(option.value));
 const result=validateProfile(profileFormInput(form));assert.equal(result.ok,true);
 if(result.ok)assert.deepEqual(result.value.certificates,before.certificates);
 const failed=profileFailureState({revision:0,values:{},fieldErrors:{},message:null,reload:false},form,{code:'invalid_input'});
 assert.deepEqual(failed.values.certificates,before.certificates);
});
