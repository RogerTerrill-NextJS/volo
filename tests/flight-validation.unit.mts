import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateFlight,type FlightField} from '../lib/flights/validation.ts';
import {canEditFlight} from '../lib/flights/ownership.ts';
import type {AccessResult} from '../lib/auth/access.ts';

const required={departure_airport:'KPAO',destination_airport:'KPAO',departure_local_date:'2026-07-01',departure_local_time:'10:15',departure_timezone:'America/Los_Angeles',aircraft_description:'C172',pilot_places:2,visibility:'NETWORK'};
function rejects(input:unknown,field?:FlightField){
  const result=validateFlight(input);assert.equal(result.ok,false);
  if(result.ok)throw Error('Expected rejection');if(field)assert.ok(result.fieldErrors[field],field);
  assert.ok(result.message);return result;
}

test('create and edit share normalized allowlisted flight data without granting ownership',()=>{
  assert.deepEqual(validateFlight({...required,departure_airport:' kpao ',destination_airport:' ksfo ',aircraft_description:' C172 ',pilot_places:'2',notes:'  Local trip  '}),{ok:true,value:{departure_airport:'KPAO',destination_airport:'KSFO',departure_at:'2026-07-01T17:15:00.000Z',departure_local_date:'2026-07-01',departure_timezone:'America/Los_Angeles',aircraft_description:'C172',pilot_places:2,notes:'Local trip',visibility:'NETWORK'}});
  assert.equal(validateFlight(required).ok,true,'Same-airport flights remain valid');
  for(const field of ['departure_airport','destination_airport','departure_local_date','departure_local_time','departure_timezone','aircraft_description','pilot_places','visibility'] as const){const input:Record<string,unknown>={...required};delete input[field];rejects(input,field);}
  assert.equal(validateFlight({...required,visibility:'PRIVATE'}).ok,true);
  rejects({...required,visibility:'GROUP'},'visibility');
});

test('capacity is a positive PostgreSQL integer and airports use existing identifier rules',()=>{
  for(const pilot_places of [0,-1,1.1,'1.1','1e2','0x10','Infinity','NaN','',true,null,{},2147483648])rejects({...required,pilot_places},'pilot_places');
  for(const pilot_places of [1,'1',2147483647,'2147483647'])assert.equal(validateFlight({...required,pilot_places}).ok,true);
  for(const field of ['departure_airport','destination_airport'] as const){
    for(const value of ['A','ABCDEFGHI','K-PAO','K PAO','😀A',1,'a\u0000b','\ud800'])rejects({...required,[field]:value},field);
    for(const value of ['12','AB12CD34'])assert.equal(validateFlight({...required,[field]:value}).ok,true);
  }
});

test('text limits match PostgreSQL character counts and optional notes clear safely',()=>{
  for(const [field,limit] of [['aircraft_description',500],['notes',2000]] as const){
    assert.equal(validateFlight({...required,[field]:'😀'.repeat(limit)}).ok,true);
    for(const value of ['😀'.repeat(limit+1),1,'a\u0000b','\ud800'])rejects({...required,[field]:value},field);
  }
  rejects({...required,aircraft_description:'  '},'aircraft_description');
  for(const notes of [undefined,null,'',' \n ']){const result=validateFlight({...required,notes});assert.ok(result.ok);assert.equal(result.value.notes,null);}
});

test('timezone failures map to safe field errors and approved occurrence choices resolve repeats',()=>{
  rejects({...required,departure_local_date:'2026-03-08',departure_local_time:'02:30'},'departure_local_time');
  const fall={...required,departure_local_date:'2026-11-01',departure_local_time:'01:30'};
  rejects(fall,'departure_occurrence');
  const later=validateFlight({...fall,departure_occurrence:'later'});assert.ok(later.ok);assert.equal(later.value.departure_at,'2026-11-01T09:30:00.000Z');
  rejects({...fall,departure_occurrence:'guess'},'departure_occurrence');
});

test('protected, derived and unexpected fields never enter a validated write payload',()=>{
  for(const field of ['id','owner_id','role','status','email','created_at','updated_at','departure_at','remaining_places','recipients','extra']){
    const result=rejects({...required,[field]:'private-canary'});assert.ok(!JSON.stringify(result).includes('private-canary'));
  }
  for(const raw of [null,[],true,'flight'])rejects(raw);
  const inherited=Object.assign(Object.create({owner_id:'spoof'}),required);rejects(inherited);
});

test('edit permission requires fresh authorized access and stored ownership, including admins',()=>{
  const owner='17500000-0000-4000-8000-000000000001',other='17500000-0000-4000-8000-000000000002';
  const access=(userId:string,role:'member'|'admin'):AccessResult=>({status:'authorized',member:{userId,role}});
  for(const role of ['member','admin'] as const){assert.equal(canEditFlight(access(owner,role),{owner_id:owner}),true);assert.equal(canEditFlight(access(other,role),{owner_id:owner}),false);}
  for(const status of ['unauthenticated','forbidden','unavailable'] as const)assert.equal(canEditFlight({status},{owner_id:owner}),false);
  assert.equal(canEditFlight(access(owner,'member'),null),false);
});
