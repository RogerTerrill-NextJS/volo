import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateFlight,validateFlightForCreation} from '../lib/flights/validation.ts';
const flight={departure_airport:'KPAO',destination_airport:'KPAO',departure_local_date:'2030-06-01',departure_local_time:'12:00',departure_timezone:'UTC',aircraft_description:'C172',pilot_places:1,visibility:'NETWORK'};
const departure=Date.parse('2030-06-01T12:00:00Z');
test('creation requires a strictly future normalized instant without changing shared edit validation',()=>{
  assert.equal(validateFlightForCreation(flight,departure-1).ok,true);
  for(const now of [departure,departure+1,NaN,Infinity]){
    const result=validateFlightForCreation(flight,now);assert.equal(result.ok,false);
    if(!result.ok)assert.ok(result.fieldErrors.departure_local_time);
  }
  assert.equal(validateFlight(flight).ok,true);
});
test('creation keeps protected-field and DST validation without echoing input',()=>{
  const result=validateFlightForCreation({...flight,owner_id:'private-canary'},departure-1);
  assert.equal(result.ok,false);assert.ok(!JSON.stringify(result).includes('private-canary'));
});
