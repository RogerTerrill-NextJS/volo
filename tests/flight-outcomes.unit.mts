import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getMvpMetrics,metricKeys} from '../lib/metrics/query.ts';
const member={userId:'22900000-0000-4000-8000-000000000001',role:'admin' as const};
test('existing metrics accepts participant-reported outcome aggregates',async()=>{
 const data={asOf:'2026-10-27T12:00:00.000000Z',outcomes:'participant_reported',...Object.fromEntries(metricKeys.map(key=>[key,0])),outcomeResponses:3,confirmedConnections:2,oneParticipantConfirmed:1,bothParticipantsConfirmed:1,conflictingConnections:0};
 assert.equal((await getMvpMetrics({access:async()=>({status:'authorized',member}),read:async()=>data})).status,'authorized');
});
import {parseOutcome,projectOutcome,type FlightOutcome} from '../lib/outcomes/validation.ts';
import {listFlightOutcomes,type OutcomePorts} from '../lib/outcomes/query.ts';
import {outcomePolicy} from '../lib/outcomes/mutation.ts';
import {emptyOutcomeForm,outcomeFormResult} from '../lib/outcomes/form-state.ts';
const requestId='22900000-0000-4000-8000-000000000030',other='22900000-0000-4000-8000-000000000003';
const outcome=():FlightOutcome=>({requestId,flightId:'22900000-0000-4000-8000-000000000020',counterpartId:other,counterpartName:'Pilot',departureAt:'2026-10-25T12:00:00.000000Z',departureTimezone:'America/Los_Angeles',departureAirport:'KPAO',destinationAirport:'KSQL',isOwner:true,answer:null,revision:0,updatedAt:null});
const saved=()=>({...outcome(),answer:true,revision:1,updatedAt:'2026-10-27T12:00:00.000000Z'});
const input=()=>({request_id:requestId,answer:'yes',expected_revision:'0'});
const ports=():OutcomePorts=>({access:async()=>({status:'authorized',member}),read:async()=>[outcome()]});
const form=()=>{const f=new FormData();for(const [k,v]of Object.entries(input()))f.set(k,v);return f;};
test('strict answer input rejects identity injection, extra fields and invalid revisions',()=>{
 assert.deepEqual(parseOutcome(input()),{requestId,answer:true,expectedRevision:0});assert.equal(parseOutcome({...input(),answer:'no'})?.answer,false);
 for(const bad of [null,[],{...input(),respondent_id:other},{...input(),answer:true},{...input(),answer:'maybe'},{...input(),expected_revision:'-1'},{...input(),expected_revision:'01'},{...input(),expected_revision:'2147483647'},{...input(),request_id:'invalid'}])assert.equal(parseOutcome(bad),null);
});
test('projection permits only own-answer DTO with coherent response state',()=>{
 assert.deepEqual(projectOutcome(outcome()),outcome());assert.deepEqual(projectOutcome(saved()),saved());
 for(const bad of [{...outcome(),otherAnswer:true},{...outcome(),answer:undefined},{...outcome(),revision:1},{...saved(),updatedAt:null},{...saved(),revision:0},{...outcome(),counterpartName:'\u0000'},{...outcome(),departureTimezone:'invalid'},{...outcome(),departureAirport:'private'}])assert.equal(projectOutcome(bad),null);
});
test('list is bounded, ordered, cursor-validated and uses latest eligibility',async()=>{
 assert.equal((await listFlightOutcomes(undefined,ports())).status,'authorized');
 let n=0;assert.deepEqual(await listFlightOutcomes(undefined,{...ports(),read:async()=>++n===1?[outcome()]:[]}),{status:'authorized',rows:[],nextCursor:null});
 assert.deepEqual(await listFlightOutcomes(['bad'],ports()),{status:'invalid'});
 for(const data of [[outcome(),outcome()],[{...outcome(),counterpartId:member.userId}],{},Array(22).fill(outcome())])assert.deepEqual(await listFlightOutcomes(undefined,{...ports(),read:async()=>data}),{status:'unavailable'});
 const page=Array.from({length:21},(_,i)=>({...outcome(),requestId:'22900000-0000-4000-8000-'+String(i+100).padStart(12,'0')}));
 const r=await listFlightOutcomes(undefined,{...ports(),read:async()=>page});assert.equal(r.status,'authorized');if(r.status==='authorized'){assert.equal(r.rows.length,20);assert.equal(r.nextCursor,page[19].requestId);}
});
test('current access/account changes discard outcomes, including final read failures',async()=>{
 for(const status of ['unauthenticated','forbidden','unavailable'] as const){assert.deepEqual(await listFlightOutcomes(undefined,{...ports(),access:async()=>({status}),read:async()=>assert.fail('Denied read')}),{status});let n=0;assert.deepEqual(await listFlightOutcomes(undefined,{...ports(),access:async()=>++n===1?{status:'authorized',member}:{status}}),{status});}
 let n=0;assert.deepEqual(await listFlightOutcomes(undefined,{...ports(),access:async()=>({status:'authorized',member:++n===1?member:{...member,userId:other}})}),{status:'forbidden'});
 assert.deepEqual(await listFlightOutcomes(undefined,{...ports(),read:async()=>{throw Error('provider-secret');}}),{status:'unavailable'});
});
test('mutation accepts only the bound own answer and preserves uncertainty/stale denial',async()=>{
 const i={requestId,answer:true,expectedRevision:0};
 const effect=async(data:unknown,error:{code?:string}|null=null)=>outcomePolicy({save:async received=>{assert.deepEqual(received,i);return {data,error};}}).effect(member,i);
 assert.deepEqual(await effect({code:'saved',outcome:saved()}),{code:'saved',outcome:saved()});
 for(const bad of [{code:'saved',outcome:{...saved(),requestId:other}},{code:'saved',outcome:{...saved(),answer:false}},{code:'saved',outcome:{...saved(),counterpartId:member.userId}},null])assert.deepEqual(await effect(bad),{code:'outcome_unconfirmed'});
 for(const code of ['stale','outcome_unavailable'])assert.deepEqual(await effect({code}),{code});
 assert.deepEqual(await effect(null,{code:'42501'}),{code:'forbidden'});
 assert.deepEqual(await effect(null,{code:'22023'}),{code:'invalid_input'});
 assert.deepEqual(await outcomePolicy({save:async()=>{throw Error('lost committed response');}}).effect(member,i),{code:'outcome_unconfirmed'});
});
test('form confirms exact receipts; ambiguous failures and stale corrections require GET recovery',()=>{
 const f=form();f.set('$ACTION_ID_fixture','native metadata');
 assert.equal(outcomeFormResult(emptyOutcomeForm,f,{code:'saved',outcome:saved()}).status,'saved');
 for(const result of [{code:'saved',outcome:{...saved(),requestId:other}},{code:'saved',outcome:{...saved(),answer:false}},{code:'outcome_unconfirmed'},{code:'stale'},{code:'forbidden'},{code:'outcome_unavailable'}])assert.equal(outcomeFormResult(emptyOutcomeForm,f,result).status,'recover');
 assert.equal(outcomeFormResult(emptyOutcomeForm,f,{code:'invalid_input'}).status,'invalid');
});
