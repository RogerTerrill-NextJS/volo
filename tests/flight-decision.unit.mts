import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseDecisionInput} from '../lib/flights/decision-input.ts';
import {decisionPolicy,type DecisionPorts} from '../lib/flights/decision-mutation.ts';
import {decisionFormResult,emptyDecisionForm} from '../lib/flights/decision-form-state.ts';
const flight='19400000-0000-4000-8000-000000000001',request='19400000-0000-4000-8000-000000000002',owner='19400000-0000-4000-8000-000000000003',other='19400000-0000-4000-8000-000000000004';
const input={flightId:flight,requestId:request,decision:'accepted' as const};
const raw={flight_id:flight,request_id:request,decision:'accepted'};
const form=()=>{const f=new FormData();for(const [k,v] of Object.entries(raw))f.set(k,v);return f;};
const ports=(data:unknown):DecisionPorts=>({readFlight:async id=>{assert.equal(id,flight);return {owner_id:owner};},decide:async value=>{assert.deepEqual(value,input);return {data,error:null};}});
test('decision input accepts only two bound UUIDs and accepted/declined choice',()=>{
 assert.deepEqual(parseDecisionInput(raw),input);
 assert.deepEqual(parseDecisionInput({...raw,decision:'declined'}),{...input,decision:'declined'});
 for(const value of [null,[],{},new Date(),{...raw,request_id:'bad'},{...raw,decision:'cancelled'},{...raw,decision:null},...['owner_id','requester_id','status','created_at','role'].map(key=>({...raw,[key]:'private-canary'}))])assert.equal(parseDecisionInput(value),null);
});
test('decision authorization requires actual ownership without an admin bypass',async()=>{
 const policy=decisionPolicy(ports({}));
 for(const role of ['member','admin'] as const){assert.equal(await policy.authorize({userId:owner,role},input),true);assert.equal(await policy.authorize({userId:other,role},input),false);}
 assert.equal(await decisionPolicy({...ports({}),readFlight:async()=>null}).authorize({userId:owner,role:'member'},input),false);
});
test('decision confirmation must bind exact request and requested state',async()=>{
 for(const code of ['decided','already_decided'])assert.deepEqual(await decisionPolicy(ports({code,requestId:request,status:'accepted',secret:'private-canary'})).effect({userId:owner,role:'member'},input),{code,requestId:request,status:'accepted'});
 for(const data of [null,[],{code:'decided',requestId:other,status:'accepted'},{code:'decided',requestId:request,status:'declined'},{code:'decided',requestId:request,status:'pending'},{code:'private-canary'}])assert.deepEqual(await decisionPolicy(ports(data)).effect({userId:owner,role:'member'},input),{code:'unavailable'});
});
test('decision capacity and stale results are safe; transport errors never claim confirmation',async()=>{
 for(const code of ['capacity_full','request_conflict','request_unavailable','request_ineligible'])assert.deepEqual(await decisionPolicy(ports({code,secret:'private-canary'})).effect({userId:owner,role:'member'},input),{code});
 for(const [error,code] of [[{code:'42501'},'forbidden'],[{code:'22023'},'invalid_input'],[{code:'private-canary'},'unavailable']] as const)assert.deepEqual(await decisionPolicy({...ports(null),decide:async()=>({data:null,error})}).effect({userId:owner,role:'member'},input),{code});
});
test('decision form trusts only bound confirmations and blocks uncertain writes',()=>{
 const good=decisionFormResult(emptyDecisionForm,form(),{code:'decided',requestId:request,status:'accepted'});assert.equal(good.status,'accepted');assert.equal(good.revision,1);
 for(const result of [{code:'unavailable'},{code:'decided',requestId:other,status:'accepted'},{code:'decided',requestId:request,status:'declined'},{code:'unexpected',status:'private-canary'}]){const state=decisionFormResult(emptyDecisionForm,form(),result);assert.equal(state.status,'unconfirmed');assert.ok(!JSON.stringify(state).includes('private-canary'));}
 for(const [code,status] of [['capacity_full','full'],['request_conflict','stale'],['request_unavailable','stale'],['request_ineligible','stale'],['forbidden','denied']] as const)assert.equal(decisionFormResult(emptyDecisionForm,form(),{code}).status,status);
 const declined=form();declined.set('decision','declined');assert.equal(decisionFormResult(good,declined,{code:'already_decided',requestId:request,status:'declined'}).status,'declined');
});
