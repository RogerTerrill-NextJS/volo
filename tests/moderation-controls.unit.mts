import assert from 'node:assert/strict';
import {test} from 'node:test';
import {emptyModerationForm,moderationFormResult} from '../lib/flights/moderation-form-state.ts';
import {getFlightModerationState,type ModerationStatePorts} from '../lib/flights/moderation-state-query.ts';
const flight='21610000-0000-4000-8000-000000000001',other='21610000-0000-4000-8000-000000000002',viewer='21600000-0000-4000-8000-000000000001',at='2026-10-25T12:00:00Z';
const form=()=>{const f=new FormData();f.set('flight_id',flight);f.set('reason',' Safety review\r\n ');f.set('confirmation','hide');return f;};
test('hide form confirms only exact target, closed lifecycle, timestamp and explicit confirmation',()=>{
 for(const code of ['hidden','already_hidden']){const result=moderationFormResult(emptyModerationForm,form(),{code,flightId:flight,moderatedAt:at,status:'cancelled'});assert.equal(result.status,'hidden');assert.equal(result.reason,'');assert.equal(result.revision,1);}
 for(const outcome of [null,{code:'hidden',flightId:other,moderatedAt:at,status:'cancelled'},{code:'hidden',flightId:flight,moderatedAt:'bad',status:'cancelled'},{code:'hidden',flightId:flight,moderatedAt:at,status:'open'}])assert.equal(moderationFormResult(emptyModerationForm,form(),outcome).status,'unconfirmed');
 const missing=form();missing.delete('confirmation');assert.equal(moderationFormResult(emptyModerationForm,missing,{code:'hidden',flightId:flight,moderatedAt:at,status:'cancelled'}).status,'unconfirmed');
});
test('uncertainty retains reason without provider output; invalid is editable and denied is frozen',()=>{
 const result=moderationFormResult(emptyModerationForm,form(),{code:'moderation_unconfirmed',message:'provider-canary'});assert.equal(result.status,'unconfirmed');assert.equal(result.reason,'Safety review');assert.match(result.message??'',/Check flight status/);assert.ok(!JSON.stringify(result).includes('provider-canary'));
 assert.equal(moderationFormResult(emptyModerationForm,form(),{code:'invalid_input'}).status,'invalid');
 for(const code of ['forbidden','unauthenticated','flight_unavailable'])assert.equal(moderationFormResult(emptyModerationForm,form(),{code}).status,'denied');
});
const ports=():ModerationStatePorts=>({access:async()=>({status:'authorized',member:{userId:viewer,role:'member'}}),read:async id=>{assert.equal(id,flight);return true;}});
test('participant state accepts only a scalar boolean and leaks no hidden post or reason',async()=>{
 for(const hidden of [true,false])assert.deepEqual(await getFlightModerationState(flight,{...ports(),read:async()=>hidden}),{status:'authorized',hidden});
 for(const value of [null,{},'true',{hidden:true,reason:'canary'}])assert.deepEqual(await getFlightModerationState(flight,{...ports(),read:async()=>value}),{status:'unavailable'});
});
test('participant state rejects invalid input, lost membership and changed identity',async()=>{
 assert.deepEqual(await getFlightModerationState('bad',{...ports(),read:async()=>assert.fail('Invalid target read')}),{status:'missing'});
 for(const status of ['unauthenticated','forbidden','unavailable'] as const)assert.deepEqual(await getFlightModerationState(flight,{...ports(),access:async()=>({status}),read:async()=>assert.fail('Denied read')}),{status});
 let reads=0;assert.deepEqual(await getFlightModerationState(flight,{...ports(),access:async()=>++reads===1?{status:'authorized',member:{userId:viewer,role:'member'}}:{status:'forbidden'}}),{status:'forbidden'});
 let checks=0;assert.deepEqual(await getFlightModerationState(flight,{...ports(),access:async()=>({status:'authorized',member:{userId:++checks===1?viewer:other,role:'member'}})}),{status:'forbidden'});
 assert.deepEqual(await getFlightModerationState(flight,{...ports(),read:async()=>{throw Error('canary');}}),{status:'unavailable'});
});
