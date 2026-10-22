import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseInterestInput} from '../lib/flights/interest-input.ts';
const id='189ABCDE-0000-4000-8000-000000000001';
test('interest input accepts only a flight UUID and optional bounded introduction',()=>{
 assert.deepEqual(parseInterestInput({flight_id:id}),{flightId:id.toLowerCase(),introductoryNote:null});
 assert.deepEqual(parseInterestInput({flight_id:id,introductory_note:''}),{flightId:id.toLowerCase(),introductoryNote:null});
 assert.deepEqual(parseInterestInput({flight_id:id,introductory_note:'Hello pilot'}),{flightId:id.toLowerCase(),introductoryNote:'Hello pilot'});
 assert.deepEqual(parseInterestInput({flight_id:id,introductory_note:'✈'.repeat(500)}),{flightId:id.toLowerCase(),introductoryNote:'✈'.repeat(500)});
 assert.ok(parseInterestInput({flight_id:id,introductory_note:'😀'.repeat(500)}),'SQL and parser both count Unicode characters');
});
test('interest input rejects protected fields, invalid shapes, nontext and oversized notes',()=>{
 for(const raw of [null,[],new Date(),{},{flight_id:'private-canary'},
  {flight_id:id,introductory_note:null},{flight_id:id,introductory_note:42},
  {flight_id:id,introductory_note:'N'.repeat(501)},
  ...['requester_id','owner_id','id','status','created_at','role','resubmit'].map(key=>({flight_id:id,[key]:'private-canary'}))])assert.equal(parseInterestInput(raw),null);
});
