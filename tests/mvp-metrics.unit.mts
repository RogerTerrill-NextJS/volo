import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getMvpMetrics,metricKeys,type MetricsPorts} from '../lib/metrics/query.ts';
const viewer='22300000-0000-4000-8000-000000000001',member={userId:viewer,role:'admin' as const};
const data=()=>Object.fromEntries([['asOf','2026-10-26T12:00:00.123456Z'],['outcomes','participant_reported'],...metricKeys.map(key=>[key,0])]);
const ports=():MetricsPorts=>({access:async()=>({status:'authorized',member}),read:async()=>data()});
test('report returns only validated aggregate counts and explicit outcome availability',async()=>{const r=await getMvpMetrics(ports());assert.equal(r.status,'authorized');if(r.status==='authorized')assert.deepEqual(r.report,data());});
test('only current admins read metrics and final role/account changes discard results',async()=>{
 for(const status of ['unauthenticated','forbidden','unavailable'] as const){assert.deepEqual(await getMvpMetrics({...ports(),access:async()=>({status}),read:async()=>assert.fail('Denied read')}),{status});let n=0;assert.deepEqual(await getMvpMetrics({...ports(),access:async()=>++n===1?{status:'authorized',member}:{status}}),{status});}
 assert.deepEqual(await getMvpMetrics({...ports(),access:async()=>({status:'authorized',member:{...member,role:'member'}}),read:async()=>assert.fail('Member read')}),{status:'forbidden'});
 for(const change of [{...member,role:'member' as const},{...member,userId:'22300000-0000-4000-8000-000000000002'}]){let n=0;assert.deepEqual(await getMvpMetrics({...ports(),access:async()=>({status:'authorized',member:++n===1?member:change})}),{status:'forbidden'});}
});
test('malformed/private payloads, invented confirmed outcomes and unsafe counts fail closed',async()=>{
 for(const raw of [null,[],{...data(),asOf:'invalid'},{...data(),messages:-1},{...data(),messages:1.5},{...data(),messages:Number.MAX_SAFE_INTEGER+1},{...data(),messages:'12'},{...data(),outcomes:'confirmed'},{...data(),messageBody:'secret'},{asOf:'2026-10-26T12:00:00Z',outcomes:'participant_reported'}])assert.deepEqual(await getMvpMetrics({...ports(),read:async()=>raw}),{status:'unavailable'});
 assert.deepEqual(await getMvpMetrics({...ports(),read:async()=>{throw Error('provider-secret');}}),{status:'unavailable'});
});
