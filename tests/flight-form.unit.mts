import assert from 'node:assert/strict';
import {test} from 'node:test';
import {emptyFlightForm,flightFormResult} from '../lib/flights/form-state.ts';

test('failed creation retains only bounded editable values without protected data',()=>{
 const form=new FormData();form.set('departure_airport',' kpao ');form.set('notes','😀'.repeat(2100));
 form.set('owner_id','private-canary');form.set('$ACTION_0','secret-canary');form.set('visibility','PRIVATE');
 const state=flightFormResult(emptyFlightForm,form,{code:'invalid_input',fieldErrors:{notes:'Use at most 2,000 characters.'}});
 assert.equal(state.status,'editing');assert.equal(state.values.departure_airport,' kpao ');
 assert.equal([...state.values.notes!].length,2000);assert.ok(state.fieldErrors.notes);
 assert.ok(!JSON.stringify(state).includes('canary'));assert.equal(state.values.visibility,undefined);
});
test('uncertain writes block immediate resubmission; confirmed writes clear entered values',()=>{
 const form=new FormData();form.set('notes','My notes');
 for(const code of ['unavailable','internal_error']){
  const state=flightFormResult(emptyFlightForm,form,{code});assert.equal(state.status,'unconfirmed');
  assert.match(state.message!,/verify/i);assert.equal(state.values.notes,'My notes');
 }
 const saved=flightFormResult(emptyFlightForm,form,{code:'created',flightId:'17700000-0000-4000-8000-000000000001'});
 assert.equal(saved.status,'created');assert.equal(saved.flightId,'17700000-0000-4000-8000-000000000001');assert.deepEqual(saved.values,{});
 const malformed=flightFormResult(saved,form,{code:'created',flightId:'private-canary'});
 assert.equal(malformed.status,'unconfirmed');assert.equal(malformed.flightId,undefined);
 const denied=flightFormResult(saved,form,{code:'forbidden',message:'private-canary'});
 assert.equal(denied.status,'denied');assert.ok(!denied.message!.includes('canary'));
});
