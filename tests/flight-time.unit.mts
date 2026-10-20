import assert from 'node:assert/strict';
import {test} from 'node:test';
import {resolveDeparture,formatDeparture} from '../lib/flights/time.ts';

const local={localDate:'2026-07-01',localTime:'10:15',timeZone:'America/Los_Angeles'};
function resolved(input:Parameters<typeof resolveDeparture>[0]){
  const result=resolveDeparture(input);assert.equal(result.ok,true);
  if(!result.ok)throw new Error('Expected a resolved departure');return result.value;
}
function rejects(input:Parameters<typeof resolveDeparture>[0],code:string){
  const result=resolveDeparture(input);assert.equal(result.ok,false);
  if(!result.ok)assert.equal(result.code,code);
}

test('departure zone determines UTC instant and calendar date independently of viewer zone',()=>{
  const before=process.env.TZ;
  try{for(const viewer of ['UTC','Pacific/Honolulu','Asia/Tokyo']){
    process.env.TZ=viewer;
    assert.deepEqual(resolved(local),{departure_at:'2026-07-01T17:15:00.000Z',departure_timezone:'America/Los_Angeles',departure_local_date:'2026-07-01'});
    assert.equal(resolved({...local,localTime:'23:30'}).departure_at,'2026-07-02T06:30:00.000Z');
    assert.equal(resolved({...local,timeZone:'Pacific/Auckland',localTime:'00:30'}).departure_at,'2026-06-30T12:30:00.000Z');
    assert.equal(formatDeparture('2026-07-01T17:15:00Z',local.timeZone)?.label,'2026-07-01 10:15 America/Los_Angeles (UTC-07:00)');
  }}finally{if(before===undefined)delete process.env.TZ;else process.env.TZ=before;}
});

test('spring-forward gaps are rejected rather than silently shifted',()=>{
  for(const occurrence of [undefined,'earlier','later'])rejects({...local,localDate:'2026-03-08',localTime:'02:30',occurrence},'nonexistent_time');
  assert.equal(resolved({...local,localDate:'2026-03-08',localTime:'01:59'}).departure_at,'2026-03-08T09:59:00.000Z');
  assert.equal(resolved({...local,localDate:'2026-03-08',localTime:'03:00'}).departure_at,'2026-03-08T10:00:00.000Z');
});

test('repeated times require an explicit earlier/later occurrence',()=>{
  const fall={...local,localDate:'2026-11-01',localTime:'01:30'};
  rejects(fall,'ambiguous_time');rejects({...fall,occurrence:''},'ambiguous_time');
  assert.equal(resolved({...fall,occurrence:'earlier'}).departure_at,'2026-11-01T08:30:00.000Z');
  assert.equal(resolved({...fall,occurrence:'later'}).departure_at,'2026-11-01T09:30:00.000Z');
  for(const occurrence of ['guess',0,true,{},null])rejects({...fall,occurrence},'invalid_occurrence');
  assert.equal(resolved({...local,occurrence:'later'}).departure_at,'2026-07-01T17:15:00.000Z');
});

test('non-hour offsets, half-hour DST and skipped dates are handled',()=>{
  assert.equal(resolved({...local,timeZone:'Asia/Kathmandu'}).departure_at,'2026-07-01T04:30:00.000Z');
  const half={localDate:'2026-04-05',localTime:'01:45',timeZone:'Australia/Lord_Howe'};
  rejects(half,'ambiguous_time');
  assert.equal(resolved({...half,occurrence:'earlier'}).departure_at,'2026-04-04T14:45:00.000Z');
  assert.equal(resolved({...half,occurrence:'later'}).departure_at,'2026-04-04T15:15:00.000Z');
  rejects({localDate:'2026-10-04',localTime:'02:15',timeZone:'Australia/Lord_Howe'},'nonexistent_time');
  rejects({localDate:'2011-12-30',localTime:'12:00',timeZone:'Pacific/Apia'},'nonexistent_time');
});

test('strict calendar and clock parsing prevents rollover and offset-bearing inputs',()=>{
  for(const localDate of ['2026-02-29','2024-02-30','2026-04-31','2026-13-01','2026-00-01','2026-01-00','0000-01-01','10000-01-01','26-07-01','2026-7-1','2026-07-01T00:00Z',null,{}])rejects({...local,localDate},'invalid_date');
  for(const localTime of ['24:00','12:60','12:00:60','1:30','12:30Z','12:30+01:00','12:30:00.1','',null,{}])rejects({...local,localTime},'invalid_time');
  assert.equal(resolved({...local,localDate:'2024-02-29',localTime:'10:15:42',timeZone:'UTC'}).departure_at,'2024-02-29T10:15:42.000Z');
  assert.equal(resolved({...local,localDate:'0099-07-01',timeZone:'UTC'}).departure_at,'0099-07-01T10:15:00.000Z');
});

test('zone validation matches named-zone/UTC database semantics',()=>{
  for(const timeZone of ['PST','GMT','+03:00','Etc/GMT+3','Etc/UTC','posix/America/Los_Angeles','right/America/Los_Angeles','Not/AZone','',null,{}])rejects({...local,timeZone},'invalid_timezone');
  assert.equal(resolved({...local,timeZone:'UTC'}).departure_at,'2026-07-01T10:15:00.000Z');
  const alias=resolved({...local,timeZone:'america/los_angeles'});assert.equal(alias.departure_timezone,'America/Los_Angeles');
  assert.equal(alias.departure_at,'2026-07-01T17:15:00.000Z');
});

test('display and edit fields retain departure semantics and distinguish repeated instants',()=>{
  const first=formatDeparture('2026-11-01T08:30:00.000Z','America/Los_Angeles');
  const second=formatDeparture('2026-11-01T09:30:00+00:00','America/Los_Angeles');
  assert.ok(first&&second);
  assert.equal(first.localDate,'2026-11-01');assert.equal(first.localTime,'01:30');
  assert.equal(first.utcOffset,'UTC-07:00');assert.equal(second.utcOffset,'UTC-08:00');
  assert.ok(first.label.includes('America/Los_Angeles'));assert.ok(second.label.includes('UTC-08:00'));
  assert.equal(first.occurrence,'earlier');assert.equal(second.occurrence,'later');
  assert.equal(resolved(first).departure_at,'2026-11-01T08:30:00.000Z');
  assert.equal(resolved(second).departure_at,'2026-11-01T09:30:00.000Z');
  const ordinary=formatDeparture('2026-07-01T17:15:42.000Z','America/Los_Angeles');assert.ok(ordinary);
  assert.equal(ordinary.localTime,'10:15:42');assert.equal(ordinary.occurrence,undefined);
  assert.equal(resolved(ordinary).departure_at,'2026-07-01T17:15:42.000Z');
  for(const instant of ['not-a-date','2026-02-30T00:00:00Z','2026-07-01','2026-07-01T00:00:00','2026-07-01T00:00:00.123Z','infinity'])assert.equal(formatDeparture(instant,'UTC'),null);
  assert.equal(formatDeparture('2026-07-01T00:00:00Z','PST'),null);
});
