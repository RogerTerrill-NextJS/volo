import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseRecipientIds,validateFlightWithRecipients,parseRecipientChange} from '../lib/flights/recipients.ts';
const A='17900000-0000-4000-8000-000000000001',B='17900000-0000-4000-8000-000000000002';
const flight={departure_airport:'KPAO',destination_airport:'KSQL',departure_local_date:'2030-06-01',departure_local_time:'12:00',departure_timezone:'UTC',aircraft_description:'C172',pilot_places:'1',visibility:'PRIVATE'};
test('recipient IDs are bounded exact unique UUID arrays, never arbitrary form authority',()=>{
 assert.deepEqual(parseRecipientIds(undefined),[]);assert.deepEqual(parseRecipientIds(JSON.stringify([A,B])),[A,B]);
 for(const value of ['bad','{}','null','"'+A+'"',JSON.stringify([A,A]),JSON.stringify([null]),JSON.stringify(['private-canary']),JSON.stringify([A.toUpperCase(),A]),' '.repeat(16385)])assert.equal(parseRecipientIds(value),null);
});
test('recipient changes accept only a flight and recipient UUID, never identity or operation overrides',()=>{
 assert.deepEqual(parseRecipientChange({flight_id:A,recipient_id:B}),{flightId:A,recipientId:B});
 for(const raw of [null,[],{flight_id:A},{flight_id:A,recipient_id:'private-canary'},{flight_id:A,recipient_id:B,owner_id:A},{flight_id:A,recipient_id:B,selected:'true'}])assert.equal(parseRecipientChange(raw),null);
});
test('nonempty selection requires PRIVATE while existing owner-only creation stays compatible',()=>{
 assert.equal(validateFlightWithRecipients(flight,0).ok,true);
 const selected=validateFlightWithRecipients({...flight,recipient_ids:JSON.stringify([B])},0);
 assert.equal(selected.ok,true);if(selected.ok)assert.deepEqual(selected.recipientIds,[B]);
 for(const raw of [{...flight,visibility:'NETWORK',recipient_ids:JSON.stringify([B])},{...flight,recipient_ids:'["private-canary"]'},{...flight,recipient_ids:'[]',owner_id:A}]){
  const denied=validateFlightWithRecipients(raw,0);assert.equal(denied.ok,false);assert.ok(!JSON.stringify(denied).includes('private-canary'));
 }
});
test('posting form requires a recipient for PRIVATE while rejecting NETWORK carryover',()=>{
 for(const recipient_ids of [undefined,'[]']){
  const result=validateFlightWithRecipients({...flight,recipient_ids},0,true);
  assert.equal(result.ok,false);if(!result.ok)assert.ok(result.fieldErrors.recipient_ids);
 }
 assert.equal(validateFlightWithRecipients({...flight,recipient_ids:JSON.stringify([B])},0,true).ok,true);
 assert.equal(validateFlightWithRecipients({...flight,visibility:'NETWORK'},0,true).ok,true);
 assert.equal(validateFlightWithRecipients({...flight,visibility:'NETWORK',recipient_ids:JSON.stringify([B])},0,true).ok,false);
});
