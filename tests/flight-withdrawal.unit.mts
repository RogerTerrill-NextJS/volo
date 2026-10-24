import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseWithdrawalInput} from '../lib/flights/withdrawal-input.ts';
import {withdrawalPolicy,type WithdrawalPorts} from '../lib/flights/withdrawal-mutation.ts';
import {withdrawalFormResult} from '../lib/flights/withdrawal-form-state.ts';
import {emptyInterestForm} from '../lib/flights/interest-form-state.ts';
const flight='19600000-0000-4000-8000-000000000001',request='19600000-0000-4000-8000-000000000002',viewer='19600000-0000-4000-8000-000000000003',other='19600000-0000-4000-8000-000000000004';
const raw={flight_id:flight,intent:'withdraw'},input={flightId:flight},member={userId:viewer,role:'member' as const};
const row={id:request,flight_id:flight,requester_id:viewer};
const ports=(data:unknown):WithdrawalPorts=>({readRequest:async(f,v)=>{assert.equal(f,flight);assert.equal(v,viewer);return row;},withdraw:async(f,r)=>{assert.equal(f,flight);assert.equal(r,request);return {data,error:null};}});
test('withdrawal accepts only a bound flight and explicit intent, never caller identity or state',()=>{
 assert.deepEqual(parseWithdrawalInput(raw),input);
 for(const value of [null,[],new Date(),{}, {...raw,flight_id:'bad'},{...raw,intent:'accept'},...['request_id','requester_id','owner_id','status','introductory_note'].map(key=>({...raw,[key]:'canary'}))])assert.equal(parseWithdrawalInput(value),null);
});
test('withdrawal derives the exact request from the active member, without a profile prerequisite or admin bypass',async()=>{
 assert.notEqual(withdrawalPolicy(ports(null)).requireCompleteProfile,true);
 for(const invalid of [null,[],{...row,id:'bad'},{...row,requester_id:other},{...row,flight_id:other}]){
  const policy=withdrawalPolicy({...ports(null),readRequest:async()=>invalid,withdraw:async()=>assert.fail('No foreign/malformed RPC')});
  assert.deepEqual(await policy.effect({...member,role:'admin'},input),{code:'request_unavailable'});
 }
});
test('withdrawal confirms exact request and status and discards extra provider fields',async()=>{
 for(const code of ['withdrawn','already_withdrawn'])assert.deepEqual(await withdrawalPolicy(ports({code,requestId:request,status:'withdrawn',secret:'canary'})).effect(member,input),{code,flightId:flight,requestId:request,status:'withdrawn'});
 for(const data of [null,[],{code:'withdrawn',requestId:other,status:'withdrawn'},{code:'withdrawn',requestId:request,status:'accepted'},{code:'canary'}])assert.deepEqual(await withdrawalPolicy(ports(data)).effect(member,input),{code:'unavailable'});
});
test('withdrawal maps stale and transport failures safely with no retries',async()=>{
 for(const code of ['request_conflict','request_unavailable'])assert.deepEqual(await withdrawalPolicy(ports({code,secret:'canary'})).effect(member,input),{code});
 for(const [error,code] of [[{code:'42501'},'forbidden'],[{code:'22023'},'invalid_input'],[{code:'55000'},'unavailable'],[{code:'canary'},'unavailable']] as const){let calls=0;assert.deepEqual(await withdrawalPolicy({...ports(null),withdraw:async()=>{calls++;return {data:null,error};}}).effect(member,input),{code});assert.equal(calls,1);}
 assert.deepEqual(await withdrawalPolicy({...ports(null),withdraw:async()=>{throw Error('canary');}}).effect(member,input),{code:'unavailable'});
});
test('withdrawal feedback trusts bound confirmation and otherwise blocks actions until reload',()=>{
 const f=new FormData();for(const [k,v] of Object.entries(raw))f.set(k,v);
 for(const code of ['withdrawn','already_withdrawn'])assert.equal(withdrawalFormResult(emptyInterestForm,f,{code,flightId:flight,requestId:request,status:'withdrawn'}).status,'withdrawn');
 for(const result of [{code:'withdrawn',flightId:other,requestId:request,status:'withdrawn'},{code:'withdrawn',flightId:flight,requestId:'bad',status:'withdrawn'},{code:'unavailable'},{code:'private-canary'}]){const state=withdrawalFormResult(emptyInterestForm,f,result);assert.equal(state.status,'withdrawal_unconfirmed');assert.ok(!JSON.stringify(state).includes('canary'));}
 for(const [code,status] of [['request_conflict','stale'],['request_unavailable','stale'],['invalid_input','stale'],['too_large','stale'],['forbidden','denied'],['unauthenticated','denied']] as const)assert.equal(withdrawalFormResult(emptyInterestForm,f,{code}).status,status);
});
