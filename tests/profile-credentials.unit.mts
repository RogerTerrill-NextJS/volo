import assert from 'node:assert/strict';
import {test} from 'node:test';
import {credentialOptions} from '../lib/profiles/credentials.ts';
import {profileFormInput} from '../lib/profiles/form-state.ts';
import {validateProfile} from '../lib/profiles/validation.ts';

test('saved aliases select canonical checkboxes while unknown legacy values remain removable',()=>{
 const options=credentialOptions('certificates',['Private pilot','PPL','Glider','constructor','__proto__']);
 assert.deepEqual(options.filter(option=>option.checked),[
  {value:'PPL-Private Pilot',checked:true,legacy:false},
  {value:'Glider',checked:true,legacy:true},
  {value:'constructor',checked:true,legacy:true},
  {value:'__proto__',checked:true,legacy:true},
 ]);
 assert.deepEqual(credentialOptions('ratings',['Instrument','MEI']).filter(option=>option.checked).map(option=>option.value),['MEI-Multi-Engine Instructor','IR-Instrument Rating']);
 assert.deepEqual(credentialOptions('ratings',['AMEL','MEI']).filter(option=>option.checked),[
  {value:'MEI-Multi-Engine Instructor',checked:true,legacy:false},
  {value:'AMEL-Airplane Multi-Engine Land',checked:true,legacy:false},
 ]);
 assert.equal(credentialOptions('certificates',['IR']).at(-1)?.legacy,true,'Never guess a different credential category');
});

test('client form extraction validates multiple selections and clearing groups',()=>{
 const form=new FormData();form.set('display_name','Pilot');form.set('home_airport','KPAO');form.set('pilot_designation','licensed');
 form.append('certificates[]',JSON.stringify('PPL-Private Pilot'));form.append('certificates[]',JSON.stringify('CPL-Commercial Pilot'));
 form.append('ratings[]',JSON.stringify('IR-Instrument Rating'));form.append('ratings[]',JSON.stringify('MEI-Multi-Engine Instructor'));form.set('$ACTION_ID_test','');
 let result=validateProfile(profileFormInput(form));assert.equal(result.ok,true);
 if(result.ok){assert.deepEqual(result.value.certificates,['PPL-Private Pilot','CPL-Commercial Pilot']);assert.deepEqual(result.value.ratings,['IR-Instrument Rating','MEI-Multi-Engine Instructor']);}
 form.delete('certificates[]');form.delete('ratings[]');result=validateProfile(profileFormInput(form));
 assert.equal(result.ok,true);if(result.ok){assert.deepEqual(result.value.certificates,[]);assert.deepEqual(result.value.ratings,[]);}
 form.append('ratings[]',new File(['x'],'x.txt'));assert.equal(validateProfile(profileFormInput(form)).ok,false);
 form.delete('ratings[]');form.set('user_id','foreign-owner');assert.equal(validateProfile(profileFormInput(form)).ok,false);
});
