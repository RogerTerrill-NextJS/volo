import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateProfile, type ProfileField} from '../lib/profiles/validation.ts';

const required = {display_name:'Student Pilot', home_airport:'KPAO', pilot_designation:'student'};
function rejects(input:unknown, field?:ProfileField) {
  const result=validateProfile(input);
  assert.equal(result.ok,false);
  if(result.ok)throw new Error('Expected validation failure');
  if(field)assert.ok(result.fieldErrors[field], `Expected an error for ${field}`);
  assert.ok(result.message);
  return result;
}

test('students and licensed pilots share normalized fields without mandatory certificates',()=>{
  assert.deepEqual(validateProfile({...required, display_name:'  Student Pilot  ',home_airport:' kpao '}),{
    ok:true,value:{...required,certificates:[],ratings:[],aircraft_access:null,flying_interests:null,bio:null},
  });
  assert.equal(validateProfile({...required,pilot_designation:'licensed'}).ok,true);
  rejects({...required,pilot_designation:'commercial'},'pilot_designation');
  for(const field of ['display_name','home_airport','pilot_designation'] as const) {
    const input:Record<string,unknown>={...required};delete input[field];rejects(input,field);
    rejects({...required,[field]:' \t\n'},field);
  }
  for(const airport of ['A','A'.repeat(9),'K-PAO','P A O','😀A'])rejects({...required,home_airport:airport},'home_airport');
  for(const airport of ['12','A'.repeat(8)])assert.equal(validateProfile({...required,home_airport:airport}).ok,true);
});

test('text bounds count Unicode characters as PostgreSQL does and allow optional clearing',()=>{
  for(const [field,limit] of [['display_name',80],['aircraft_access',500],['flying_interests',500],['bio',2000]] as const) {
    assert.equal(validateProfile({...required,[field]:'😀'.repeat(limit)}).ok,true,field);
    rejects({...required,[field]:'😀'.repeat(limit+1)},field);
    rejects({...required,[field]:1},field);
    rejects({...required,[field]:'contains\u0000null'},field);
    rejects({...required,[field]:'unpaired\ud800'},field);
  }
  const cleared=validateProfile({...required,aircraft_access:' \n ',flying_interests:null,bio:''});
  assert.equal(cleared.ok,true);
  if(cleared.ok)assert.deepEqual([cleared.value.aircraft_access,cleared.value.flying_interests,cleared.value.bio],[null,null,null]);
});

test('label arrays and line-separated form values share one bounded normalization',()=>{
  const result=validateProfile({...required,certificates:[' Private pilot ','Glider'],ratings:' Instrument\r\n Multi-engine '});
  assert.equal(result.ok,true);
  if(result.ok){assert.deepEqual(result.value.certificates,['Private pilot','Glider']);assert.deepEqual(result.value.ratings,['Instrument','Multi-engine']);}
  for(const field of ['certificates','ratings'] as const) {
    assert.equal(validateProfile({...required,[field]:Array(20).fill('😀'.repeat(80))}).ok,true);
    for(const labels of [Array(21).fill('Pilot'),['a'.repeat(81)],[' '],[null],[['Glider']],{},null,['a\u0000b'],['\ud800'],['Glider',,'Pilot'],'Glider\n\nPilot'])rejects({...required,[field]:labels},field);
    for(const labels of [undefined,[], '', ' \n '])assert.equal(validateProfile({...required,[field]:labels}).ok,true);
  }
});

test('protected and unexpected fields are rejected without returning submitted values',()=>{
  for(const field of ['user_id','role','status','email','created_at','updated_at','photo_storage_path','extra']) {
    const result=rejects({...required,[field]:'private-canary'});
    assert.ok(!JSON.stringify(result).includes('private-canary'));
  }
  for(const value of [null,[],true,'profile'])rejects(value);
  const result=rejects({display_name:'',home_airport:'?',pilot_designation:''});
  assert.deepEqual(Object.keys(result.fieldErrors).sort(),['display_name','home_airport','pilot_designation']);
});
