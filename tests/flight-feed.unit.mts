import assert from 'node:assert/strict';
import {test} from 'node:test';
import {listUpcomingFlights,type FlightFeedPorts} from '../lib/flights/feed-query.ts';
const id=(n:number)=>`18100000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const access={status:'authorized' as const,member:{userId:id(99),role:'member' as const}};
const now=Date.parse('2030-06-01T00:00:00Z');
const row=(n=1,departure_at='2030-06-01T18:00:00.000001+00:00')=>({id:id(n),owner_id:id(90),departure_airport:'KPAO',destination_airport:'KSQL',departure_at,departure_timezone:'America/Los_Angeles',departure_local_date:'2030-06-01',aircraft_description:'C172',pilot_places:2,visibility:'NETWORK',status:'open'});
const ports=(rows:unknown=[]):FlightFeedPorts=>({access:async()=>access,now:()=>now,readRows:async()=>rows});

test('feed denies unauthenticated/inactive viewers before any read and rejects revoked or switched access',async()=>{
 for(const status of ['unauthenticated','forbidden','unavailable'] as const){
  let reads=0;
  assert.deepEqual(await listUpcomingFlights({}, {...ports(),access:async()=>({status}),readRows:async()=>{reads++;return [];}}),{status});assert.equal(reads,0);
 }
 for(const changed of [{status:'forbidden' as const},{status:'unavailable' as const},{status:'authorized' as const,member:{userId:id(98),role:'member' as const}}]){
  let checks=0;assert.notEqual((await listUpcomingFlights({}, {...ports([row()]),access:async()=>++checks===1?access:changed})).status,'authorized');assert.equal(checks,2);
 }
});
test('feed normalizes exact airports and inclusive local dates while rejecting invalid filters before querying',async()=>{
 let page:unknown;
 const p={...ports(),readRows:async(value:unknown)=>{page=value;return [];}};
 assert.deepEqual(await listUpcomingFlights({departureAirport:' kpao ',destinationAirport:'ksql',dateFrom:'2030-06-01',dateTo:'2030-06-02'},p),{status:'authorized',rows:[],nextCursor:null});
 assert.deepEqual(page,{criteria:{departureAirport:'KPAO',destinationAirport:'KSQL',dateFrom:'2030-06-01',dateTo:'2030-06-02'},after:null,pageSize:20,now:'2030-06-01T00:00:00.000000Z'});
 for(const raw of [null,[],{pageSize:0},{pageSize:51},{pageSize:'2'},{after:'x'.repeat(2049)},{after:'{}'},{departureAirport:'PA'+'O,or(id.gt.0)'},{destinationAirport:null},{dateFrom:'2030-02-29'},{dateTo:'2030-06-31'},{dateFrom:'2030-06-02',dateTo:'2030-06-01'},{dateFrom:'2030-06-01T00:00:00Z'},{visibility:'PRIVATE'},{owner_id:id(90)}]){
  let reads=0;assert.deepEqual(await listUpcomingFlights(raw,{...p,readRows:async()=>{reads++;return [];}}),{status:'invalid'});assert.equal(reads,0);
 }
});
test('feed cursor retains microseconds, breaks tied timestamps by ID and binds normalized filters',async()=>{
 const first=await listUpcomingFlights({pageSize:1,departureAirport:'kpao'},ports([row(1),row(2)]));
 assert.equal(first.status,'authorized');if(first.status!=='authorized')return;
 assert.equal(first.rows.length,1);assert.ok(first.nextCursor);assert.equal(first.rows[0].departure_at,'2030-06-01T18:00:00.000001Z');
 let after:unknown;
 const next=await listUpcomingFlights({pageSize:1,departureAirport:' KPAO ',after:first.nextCursor},{...ports([row(2)]),readRows:async(page)=>{after=page.after;return [row(2)];}});
 assert.deepEqual(after,{departureAt:'2030-06-01T18:00:00.000001Z',id:id(1)});
 assert.equal(next.status,'authorized');if(next.status==='authorized'){assert.deepEqual(next.rows.map(r=>r.id),[id(2)]);assert.equal(next.nextCursor,null);}
 assert.deepEqual(await listUpcomingFlights({departureAirport:'KSQL',after:first.nextCursor},ports()),{status:'invalid'});
 assert.deepEqual(await listUpcomingFlights({departureAirport:'KPAO',after:first.nextCursor},ports([row(1)])),{status:'unavailable'},'Rows cannot repeat the cursor boundary');
 const micro=await listUpcomingFlights({pageSize:1},ports([row(9),row(1,'2030-06-01T18:00:00.000002Z')]));
 assert.equal(micro.status,'authorized','A later microsecond sorts after a larger UUID');
});
test('feed projects only card fields without recipient lists, notes, private account data or invented availability',async()=>{
 const result=await listUpcomingFlights({},ports([{...row(),notes:'private-canary',email:'private-canary',recipients:['private-canary'],role:'admin'}]));
 assert.equal(result.status,'authorized');if(result.status!=='authorized')return;
 assert.deepEqual(result.rows,[{id:id(1),owner_id:id(90),departure_airport:'KPAO',destination_airport:'KSQL',departure_at:'2030-06-01T18:00:00.000001Z',departure_timezone:'America/Los_Angeles',departure_local_date:'2030-06-01',aircraft_description:'C172',pilot_places:2,visibility:'NETWORK',isOwn:false}]);
 assert.ok(!JSON.stringify(result).includes('private-canary'));
});
test('feed fails closed on corrupt rows, past/terminal data, invalid ordering and broken filters',async()=>{
 for(const rows of [null,[null],[{...row(),departure_airport:null}],[{...row(),visibility:{toString:()=> 'NETWORK'}}],[{...row(),status:'cancelled'}],[{...row(),status:'completed'}],[row(1,'2030-05-31T18:00:00Z')],[row(1,'2030-06-01T00:00:00Z')],[{...row(),pilot_places:0}],[{...row(),departure_timezone:'Not/AZone'}],[{...row(),departure_local_date:'2030-06-02'}],[row(2),row(1)],[row(1),row(1)],[row(2,'2030-06-01T18:00:00.000002Z'),row(1)],Array.from({length:22},(_,i)=>row(i+1))])assert.deepEqual(await listUpcomingFlights({},ports(rows)),{status:'unavailable'});
 assert.deepEqual(await listUpcomingFlights({departureAirport:'KSFO'},ports([row()])),{status:'unavailable'});
 assert.deepEqual(await listUpcomingFlights({dateFrom:'2030-06-02'},ports([row()])),{status:'unavailable'});
 assert.deepEqual(await listUpcomingFlights({}, {...ports(),readRows:async()=>{throw Error('private-canary');}}),{status:'unavailable'});
});
test('feed uses the current instant on every page and preserves microsecond departures just after now',async()=>{
 const result=await listUpcomingFlights({},ports([row(1,'2030-06-01T00:00:00.000001Z')]));
 // Los Angeles is still on the prior local date at midnight UTC.
 assert.equal(result.status,'unavailable','Incorrect derived local date must fail closed');
 const valid=await listUpcomingFlights({},ports([{...row(1,'2030-06-01T00:00:00.000001Z'),departure_local_date:'2030-05-31'}]));assert.equal(valid.status,'authorized');
 let clock=now;const seen:string[]=[];
 const p:FlightFeedPorts={...ports(),now:()=>clock,readRows:async(page)=>{seen.push(page.now);return page.after?[]:[row(1),row(2)];}};
 const first=await listUpcomingFlights({pageSize:1},p);assert.equal(first.status,'authorized');
 if(first.status==='authorized'){clock=now+86400000;assert.deepEqual(await listUpcomingFlights({pageSize:1,after:first.nextCursor},p),{status:'authorized',rows:[],nextCursor:null});}
 assert.deepEqual(seen,['2030-06-01T00:00:00.000000Z','2030-06-02T00:00:00.000000Z']);
 assert.deepEqual(await listUpcomingFlights({}, {...ports(),now:()=>NaN}),{status:'unavailable'});
});

test('feed ownership is derived from the verified viewer, never role or supplied ownership metadata',async()=>{
 for(const role of ['member','admin'] as const)for(const own of [false,true]){
  const viewer=own?id(90):id(99);
  const result=await listUpcomingFlights({}, {...ports([{...row(),isOwn:!own,user_metadata:{userId:id(90)},role:'admin'}]),access:async()=>({status:'authorized',member:{userId:viewer,role}})});
  assert.equal(result.status,'authorized');if(result.status!=='authorized')return;
  assert.equal(result.rows[0].isOwn,own);
 }
});
