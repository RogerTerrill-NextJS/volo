import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseCancellationInput} from '../lib/flights/cancellation-input.ts';
import {cancellationPolicy,type CancellationPorts} from '../lib/flights/cancellation-mutation.ts';
import {cancellationFormResult,emptyCancellationForm} from '../lib/flights/cancellation-form-state.ts';
const flight='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002';
const raw={flight_id:flight,intent:'cancel',confirmation:'cancel'},input={flightId:flight},member={userId:other,role:'member' as const};
const ports=(data:unknown):CancellationPorts=>({cancel:async id=>{assert.equal(id,flight);return {data,error:null};}});
test('cancellation requires explicit confirmation and rejects caller identity or lifecycle state',()=>{
 assert.deepEqual(parseCancellationInput(raw),input);
 for(const value of [null,[],new Date(),{}, {...raw,flight_id:'bad'},{...raw,intent:'withdraw'},{...raw,confirmation:undefined},...['owner_id','role','status','request_id'].map(key=>({...raw,[key]:'canary'}))])assert.equal(parseCancellationInput(value),null);
});
test('cancellation confirms only the bound flight and closed status without provider extras',async()=>{
 for(const code of ['cancelled','already_cancelled']){
  const policy=cancellationPolicy(ports({code,flightId:flight,status:'cancelled',secret:'canary'}));
  assert.notEqual(policy.requireCompleteProfile,true);
  assert.deepEqual(policy.parse(raw),{ok:true,value:input});
  assert.deepEqual(await policy.effect(member,input),{code,flightId:flight,status:'cancelled'});
 }
 for(const data of [null,[],{code:'cancelled',flightId:other,status:'cancelled'},{code:'cancelled',flightId:flight,status:'open'},{code:'canary'}])assert.deepEqual(await cancellationPolicy(ports(data)).effect(member,input),{code:'unavailable'});
});
test('cancellation maps current access and transport failures with no automatic retries',async()=>{
 assert.deepEqual(await cancellationPolicy(ports({code:'flight_conflict',secret:'canary'})).effect(member,input),{code:'flight_conflict'});
 for(const [error,code] of [[{code:'42501'},'forbidden'],[{code:'22023'},'invalid_input'],[{code:'private-canary'},'unavailable']] as const){let calls=0;assert.deepEqual(await cancellationPolicy({cancel:async()=>{calls++;return {data:null,error};}}).effect(member,input),{code});assert.equal(calls,1);}
 assert.deepEqual(await cancellationPolicy({cancel:async()=>{throw Error('canary');}}).effect(member,input),{code:'unavailable'});
});
test('cancellation feedback blocks further saves unless the exact confirmed outcome is known',()=>{
 const form=new FormData();for(const [k,v] of Object.entries(raw))form.set(k,v);
 for(const code of ['cancelled','already_cancelled'])assert.equal(cancellationFormResult(emptyCancellationForm,form,{code,flightId:flight,status:'cancelled'}).status,'cancelled');
 for(const result of [{code:'cancelled',flightId:other,status:'cancelled'},{code:'cancelled',flightId:flight,status:'open'},{code:'unavailable'},{code:'private-canary'}]){
  const state=cancellationFormResult(emptyCancellationForm,form,result);assert.equal(state.status,'unconfirmed');assert.equal(state.revision,1);assert.ok(!JSON.stringify(state).includes('canary'));
 }
 for(const [code,status] of [['flight_conflict','stale'],['invalid_input','stale'],['too_large','stale'],['forbidden','denied'],['unauthenticated','denied']] as const)assert.equal(cancellationFormResult(emptyCancellationForm,form,{code}).status,status);
 form.delete('confirmation');assert.equal(cancellationFormResult(emptyCancellationForm,form,{code:'cancelled',flightId:flight,status:'cancelled'}).status,'unconfirmed');
});
