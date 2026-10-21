import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Reuse the existing creation actors, compiled app and disposable database.
export async function verifyUpcomingFlightFeed({stack,app,scenario,accounts,sessions,admin}){
 const year=new Date().getUTCFullYear()+2,day=`${year}-06-01`,nextDay=`${year}-06-02`;
 const ids=Object.fromEntries(['a','b','c','own','selected','hidden','utc','local','cancelled','completed','past'].map(key=>[key,randomUUID()]));
 const checked=async query=>{const r=await query.retry(false);assert.equal(r.error,null,'Owned feed fixture operation'+(r.error?.code?' ('+r.error.code+')':''));return r.data;};
 const fixture=(key,extra={})=>({id:ids[key],owner_id:accounts.member.id,departure_airport:'KPAO',destination_airport:'KSQL',departure_at:nextDay+'T00:30:00.000001Z',departure_timezone:'America/Los_Angeles',aircraft_description:'Owned feed C172',pilot_places:2,visibility:'NETWORK',...extra});
 const records=[fixture('a'),fixture('b'),fixture('c',{departure_at:nextDay+'T00:30:00.000002Z'}),fixture('own',{visibility:'PRIVATE',departure_at:nextDay+'T01:00:00Z'}),fixture('selected',{visibility:'PRIVATE',owner_id:accounts.admin.id,departure_at:nextDay+'T02:00:00Z'}),fixture('hidden',{visibility:'PRIVATE',owner_id:accounts.admin.id,notes:'private-feed-canary',departure_at:nextDay+'T03:00:00Z'}),fixture('utc',{departure_timezone:'UTC'}),fixture('local',{destination_airport:'KPAO'}),fixture('cancelled',{status:'cancelled'}),fixture('completed',{status:'completed'}),fixture('past',{departure_at:'2000-01-01T00:00:00Z'})];
 const ordered=keys=>keys.map(key=>records.find(r=>r.id===ids[key])).sort((a,b)=>a.departure_at.localeCompare(b.departure_at)||a.id.localeCompare(b.id)).map(r=>r.id);
 const call=async(label,input={dateFrom:day})=>{
  const response=await app.request('/api/flight-feed-fixture',{method:'POST',session:sessions[label],headers:{'content-type':'application/json'},body:JSON.stringify(input)});
  assert.equal(response.status,200);
  for(const h of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(response.headers.get(h)??'',/no-store/);
  const text=await response.text();stack.assertNoCredentialLeaks(text);
  for(const s of Object.values(sessions))s.assertNoCredentialLeaks(text);
  for(const account of Object.values(accounts))assert.ok(!text.includes(account.email));
  assert.ok(!text.includes('private-feed-canary'));
  return JSON.parse(text);
 };
 const control=async mode=>{assert.equal((await app.request('/api/flight-feed-control',{method:'POST',body:mode})).status,200);};
 const calls=async()=> (await (await app.request('/api/flight-feed-control')).json()).calls;
 try{
  await scenario('flight_feed_session_rls_and_minimal_projection',async()=>{
   // Mixed status fixtures must use database defaults for omitted fields.
   await checked(admin.from('flights').insert(records,{defaultToNull:false}));
   await checked(admin.from('flight_recipients').insert([{flight_id:ids.own,user_id:accounts.noProfile.id},{flight_id:ids.selected,user_id:accounts.member.id}]));
   const member=await call('member');assert.equal(member.status,'authorized');
   assert.deepEqual(member.rows.filter(r=>Object.values(ids).includes(r.id)).map(r=>r.id),ordered(['a','b','c','utc','local','own','selected']));
   const other=await call('noProfile');assert.equal(other.status,'authorized');assert.ok(other.rows.some(r=>r.id===ids.own));assert.ok(!other.rows.some(r=>r.id===ids.selected||r.id===ids.hidden));
   const ordinaryAdmin=await call('admin');assert.ok(!ordinaryAdmin.rows.some(r=>r.id===ids.own),'Admin has no unrelated PRIVATE bypass');
   assert.ok(ordinaryAdmin.rows.some(r=>r.id===ids.hidden),'An owner retains their PRIVATE read');
   assert.deepEqual(Object.keys(member.rows.find(r=>r.id===ids.a)).sort(),['id','owner_id','departure_airport','destination_airport','departure_at','departure_timezone','departure_local_date','aircraft_description','pilot_places','visibility'].sort());
   for(const [label,status] of [[null,'unauthenticated'],['disabled','forbidden'],['absent','forbidden']])assert.deepEqual(await call(label),{status});
  });
  await scenario('flight_feed_combined_filters_stable_pages_and_local_dates',async()=>{
   const criteria={departureAirport:' kpao ',destinationAirport:' ksql ',dateFrom:day,dateTo:day,pageSize:1};
   const result=[];let after;let pages=0;
   do{const page=await call('member',{...criteria,...(after?{after}:{})});assert.equal(page.status,'authorized');assert.ok(page.rows.length<=1);result.push(...page.rows.map(r=>r.id));after=page.nextCursor;assert.ok(++pages<20,'Cursor must advance');}while(after);
   assert.deepEqual(result,ordered(['a','b','c','own','selected']),'Combined filters apply before every page limit');
   const utc=await call('member',{departureAirport:'KPAO',destinationAirport:'KSQL',dateFrom:nextDay,dateTo:nextDay});
   assert.deepEqual(utc.rows.map(r=>r.id),[ids.utc],'Calendar filters use the stored departure-local date, not UTC or viewer date');
   const empty=await call('member',{departureAirport:'ZZZZ'});assert.deepEqual(empty,{status:'authorized',rows:[],nextCursor:null});
  });
  await scenario('flight_feed_cursors_do_not_retain_visibility_or_membership_grants',async()=>{
   const criteria={departureAirport:'KPAO',destinationAirport:'KSQL',dateFrom:day,dateTo:day,pageSize:1};
   const first=await call('member',criteria);assert.ok(first.nextCursor);
   await checked(admin.from('flights').delete().eq('id',first.rows[0].id));
   const next=await call('member',{...criteria,after:first.nextCursor});assert.equal(next.status,'authorized');assert.ok(next.rows.length===1&&next.rows[0].id!==first.rows[0].id,'Cursor does not require an extant reference row');
   await stack.setMembership(accounts.member.id,{role:'member',status:'disabled'});
   try{assert.deepEqual(await call('member',{...criteria,after:first.nextCursor}),{status:'forbidden'});}finally{await stack.setMembership(accounts.member.id,{role:'member',status:'active'});}
   await checked(admin.from('flight_recipients').delete().eq('flight_id',ids.own).eq('user_id',accounts.noProfile.id));
   const revoked=await call('noProfile');assert.ok(!revoked.rows.some(r=>r.id===ids.own),'Removed recipients lose results on the next query');
  });
  await scenario('flight_feed_rechecks_after_read_and_sanitizes_provider_failures',async()=>{
   const before=await calls();for(const input of [{departureAirport:'KPAO,or(id.gt.0)'},{pageSize:51},{dateFrom:nextDay,dateTo:day},{after:'{}'}])assert.deepEqual(await call('member',input),{status:'invalid'});
   assert.equal(await calls(),before,'Invalid input never reaches the data API');
   await control('disable-after-read:'+accounts.member.id);
   try{assert.deepEqual(await call('member'),{status:'forbidden'},'Membership changed during the read discards all rows');}finally{await control('off');await stack.setMembership(accounts.member.id,{role:'member',status:'active'});}
   await control('outage');try{assert.deepEqual(await call('member'),{status:'unavailable'});}finally{await control('off');}
  });
  const pageRead=async(label,path,headers={})=>{
   const response=await app.request(path,{session:sessions[label],headers});
   for(const h of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(response.headers.get(h)??'',/no-store/);
   const raw=await response.text();stack.assertNoCredentialLeaks(raw);for(const session of Object.values(sessions))session.assertNoCredentialLeaks(raw);
   // React separates adjacent SSR text nodes with comments; assert the visible copy.
   const text=raw.replace(/<!--[\s\S]*?-->/g,'');
   for(const account of Object.values(accounts))assert.ok(!text.includes(account.email));
   return {response,text};
  };
  await scenario('flight_feed_page_filters_pagination_and_local_time',async()=>{
   const paging=[];
   for(let i=1;i<=21;i++){
    ids['page'+i]=randomUUID();
    paging.push(fixture('page'+i,{departure_airport:'KSQL',destination_airport:'KSFO',departure_at:nextDay+`T12:00:${String(i).padStart(2,'0')}.000001Z`,departure_timezone:'UTC',aircraft_description:'Owned page C172 '+String(i).padStart(2,'0')}));
   }
   await checked(admin.from('flights').insert(paging));
   const route='/dashboard/flights?departureAirport=ksql&destinationAirport=ksfo&dateFrom='+nextDay+'&dateTo='+nextDay;
   const {text}=await pageRead('member',route);assert.ok(text.includes('20 flights on this page'),'First page reports 20 rendered flights');assert.ok(text.includes('Owned page C172 01'));assert.ok(!text.includes('Owned page C172 21'));
   assert.ok(text.includes('Joining-pilot capacity'));assert.ok(!text.includes('places available'));
   const next=text.match(/href="([^"]+)"[^>]*>Next page/)?.[1]?.replaceAll('&amp;','&');assert.ok(next,'Actual page has a continuation link');
   const url=new URL(next,app.origin);for(const [key,want] of [['departureAirport','KSQL'],['destinationAirport','KSFO'],['dateFrom',nextDay],['dateTo',nextDay]])assert.equal(url.searchParams.get(key),want);
   const second=await pageRead('member',url.pathname+url.search);assert.ok(second.text.includes('1 flight on this page'));assert.ok(second.text.includes('Owned page C172 21'));assert.ok(!second.text.includes('Owned page C172 01'));assert.ok(second.text.includes('Back to first page'));
   const local=await pageRead('member','/dashboard/flights?dateFrom='+day+'&dateTo='+day);assert.ok(local.text.includes(day+' at 17:30'),'Departure uses local date/time in rendered copy');assert.ok(local.text.includes('America/Los_Angeles'));assert.ok(local.text.includes('UTC-07:00'));assert.ok(!local.text.includes(ids.hidden),'Unrelated PRIVATE flight never enters HTML or serialized payload');
   const rsc=await pageRead('noProfile','/dashboard/flights?dateFrom='+day,{RSC:'1'});assert.ok(!rsc.text.includes(ids.hidden));assert.ok(!rsc.text.includes(ids.selected));
  });
  await scenario('flight_feed_page_access_empty_invalid_and_retry_states',async()=>{
   const anonymous=await pageRead(null,'/dashboard/flights');assert.equal(anonymous.response.status,307);
   const denied=await pageRead('disabled','/dashboard/flights');assert.ok(denied.text.includes('Access denied'));assert.ok(!denied.text.includes('Owned page C172'));
   const empty=await pageRead('member','/dashboard/flights?departureAirport=ZZZZ');assert.ok(empty.text.includes('No flights match these filters'));assert.ok(empty.text.includes('Clear filters'));
   for(const query of ['departureAirport=KPAO&departureAirport=KSQL','dateFrom=2030-06-31','after=bad'])assert.ok((await pageRead('member','/dashboard/flights?'+query)).text.includes('Check your flight filters or page link'));
   await control('outage');try{
    const failed=await pageRead('member','/dashboard/flights?departureAirport=KSQL');assert.ok(failed.text.includes('Flights temporarily unavailable'));assert.ok(failed.text.includes('Try again'));assert.ok(!failed.text.includes('private-feed-error-canary'));
   }finally{await control('off');}
   assert.ok((await pageRead('member','/dashboard/flights?departureAirport=KSQL')).text.includes('Owned page C172'),'Retry recovers without clearing filters');
  });

 }finally{
  await control('off');
  await checked(admin.from('flight_recipients').delete().in('flight_id',Object.values(ids)));
  await checked(admin.from('flights').delete().in('id',Object.values(ids)));
 }
}
