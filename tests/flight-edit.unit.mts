import assert from 'node:assert/strict';
import {test} from 'node:test';
import {normalizeEditInstant,validateEditInput} from '../lib/flights/edit-input.ts';
import {flightEditPolicy,type EditPorts} from '../lib/flights/edit-mutation.ts';
import {editFormResult} from '../lib/flights/edit-form-state.ts';
import {emptyFlightForm} from '../lib/flights/form-state.ts';
import {getFlightEdit,type EditQueryPorts} from '../lib/flights/edit-query.ts';
const flight='19800000-0000-4000-8000-000000000001',owner='19800000-0000-4000-8000-000000000002',other='19800000-0000-4000-8000-000000000003',revision='2030-01-01T00:00:00.123456Z';
const raw={flight_id:flight,expected_updated_at:revision,departure_airport:'KPAO',destination_airport:'KSQL',departure_local_date:'2099-11-01',departure_local_time:'09:30:00',departure_timezone:'UTC',departure_occurrence:'',aircraft_description:'C172',pilot_places:'2',notes:'Draft edit'};
const input=()=>{const v=validateEditInput(raw);assert.ok(v.ok);return v;};
const ports=(data:unknown):EditPorts=>({readRow:async id=>{assert.equal(id,flight);return {id:flight,owner_id:owner,departure_at:'2099-11-01T09:30:00.987654+00:00',departure_timezone:'UTC'};},edit:async value=>{assert.equal(value.flightId,flight);assert.equal(value.expectedUpdatedAt,revision);assert.equal(value.value.departure_at,'2099-11-01T09:30:00.987654Z');return {data,error:null};}});
test('edit validation preserves microsecond revision and rejects protected fields and DST gaps',()=>{
 assert.equal(normalizeEditInstant(revision),revision);assert.equal(normalizeEditInstant('2030-02-30T00:00:00Z'),null);assert.ok(validateEditInput(raw).ok);
 for(const key of ['owner_id','status','visibility','recipient_ids','updated_at'])assert.equal(validateEditInput({...raw,[key]:'canary'}).ok,false);
 assert.equal(validateEditInput({...raw,expected_updated_at:'bad'}).ok,false);
 assert.equal(validateEditInput({...raw,departure_local_date:'2030-03-10',departure_local_time:'02:30',departure_timezone:'America/Los_Angeles'}).ok,false);
 assert.equal(validateEditInput({...raw,departure_local_date:'2030-11-03',departure_local_time:'01:30',departure_timezone:'America/Los_Angeles'}).ok,false);
 assert.equal(validateEditInput({...raw,departure_local_date:'2030-11-03',departure_local_time:'01:30',departure_timezone:'America/Los_Angeles',departure_occurrence:'later'}).ok,true);
});
const stored={id:flight,owner_id:owner,updated_at:revision,departure_airport:'KPAO',destination_airport:'KSQL',departure_at:'2099-11-01T09:30:00.987654Z',departure_timezone:'UTC',departure_local_date:'2099-11-01',aircraft_description:'C172',pilot_places:2,notes:'Stored notes',status:'open',visibility:'PRIVATE'};
const queryPorts:EditQueryPorts={access:async()=>({status:'authorized',member:{userId:owner,role:'member'}}),readRow:async()=>stored,readAccepted:async()=>1,profile:async()=>'complete',now:()=>Date.now()};
test('edit query loads only owned, valid, stable snapshots with full revision and local time',async()=>{
 const result=await getFlightEdit(flight,queryPorts);assert.equal(result.status,'authorized');if(result.status==='authorized'){assert.equal(result.acceptedCount,1);assert.equal(result.initial.expectedUpdatedAt,revision);assert.equal(result.initial.values.departure_local_time,'09:30');assert.equal(result.visibility,'PRIVATE');}
 assert.deepEqual(await getFlightEdit(flight,{...queryPorts,readRow:async()=>({...stored,owner_id:other})}),{status:'missing'});
 let reads=0;assert.deepEqual(await getFlightEdit(flight,{...queryPorts,readRow:async()=>++reads===1?stored:{...stored,updated_at:'2030-01-01T00:00:00.123457Z'}}),{status:'unavailable'});
});
test('edit query fails closed for revoked access, missing profile, bad count and closed flights',async()=>{
 let checks=0;assert.deepEqual(await getFlightEdit(flight,{...queryPorts,access:async()=>++checks===1?{status:'authorized',member:{userId:owner,role:'member'}}:{status:'forbidden'}}),{status:'forbidden'});
 assert.deepEqual(await getFlightEdit(flight,{...queryPorts,profile:async()=>'missing'}),{status:'profile_required'});
 assert.deepEqual(await getFlightEdit(flight,{...queryPorts,readAccepted:async()=>3}),{status:'unavailable'});
 assert.deepEqual(await getFlightEdit(flight,{...queryPorts,readRow:async()=>({...stored,status:'cancelled'})}),{status:'closed'});
});
test('edit policy requires exact actual owner, no admin bypass, before RPC',async()=>{
 const p=flightEditPolicy({...ports(null),edit:async()=>assert.fail('Foreign edit never reaches RPC')});
 assert.deepEqual(await p.effect({userId:other,role:'admin'},input()),{code:'forbidden'});
});
test('edit preserves original subsecond instant and projects only bound confirmations',async()=>{
 for(const code of ['updated','already_updated'])assert.deepEqual(await flightEditPolicy(ports({code,flightId:flight,updatedAt:revision,secret:'canary'})).effect({userId:owner,role:'member'},input()),{code,flightId:flight,updatedAt:revision});
 for(const data of [null,[],{code:'updated',flightId:other,updatedAt:revision},{code:'updated',flightId:flight,updatedAt:'bad'}])assert.equal((await flightEditPolicy(ports(data)).effect({userId:owner,role:'member'},input())).code,'unavailable');
});
test('edit stale, material, capacity and transport outcomes remain safe and never retry',async()=>{
 for(const code of ['flight_conflict','capacity_conflict','repost_required','flight_unavailable'])assert.deepEqual(await flightEditPolicy(ports({code,secret:'canary'})).effect({userId:owner,role:'member'},input()),{code});
 let calls=0;const result=await flightEditPolicy({...ports(null),edit:async()=>{calls++;throw Error('canary');}}).effect({userId:owner,role:'member'},input());assert.deepEqual(result,{code:'unavailable'});assert.equal(calls,1);
});
test('edit feedback confirms only matching flight/revision, preserves drafts and blocks uncertain or stale writes',()=>{
 const form=new FormData();for(const [k,v] of Object.entries(raw))form.set(k,v);
 assert.equal(editFormResult(emptyFlightForm,form,{code:'updated',flightId:flight,updatedAt:revision}).status,'updated');
 for(const code of ['flight_conflict','capacity_conflict','repost_required','flight_unavailable']){const s=editFormResult(emptyFlightForm,form,{code});assert.equal(s.status,'stale');assert.equal(s.values.notes,'Draft edit');}
 for(const result of [{code:'unavailable'},{code:'updated',flightId:other,updatedAt:revision},{code:'updated',flightId:flight,updatedAt:'canary'}]){const s=editFormResult(emptyFlightForm,form,result);assert.equal(s.status,'unconfirmed');assert.ok(!JSON.stringify(s).includes('canary'));}
});
