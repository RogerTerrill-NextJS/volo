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
   assert.deepEqual(Object.keys(member.rows.find(r=>r.id===ids.a)).sort(),['id','owner_id','departure_airport','destination_airport','departure_at','departure_timezone','departure_local_date','aircraft_description','pilot_places','visibility','isOwn'].sort());
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
   for(let attempt=0;attempt<3;attempt++){
    const session=sessions[label];
    // The fixture JWT lasts 120s and the SDK refreshes inside 90s. Keep
    // headroom so a multi-check read cannot cross that window mid-render.
    // Refresh the owned cookie jar; never re-login or change membership.
    if(session&&session.expiresAt*1000-Date.now()<110000)await session.refresh();
    const response=await app.request(path,{session,headers});
    for(const h of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(response.headers.get(h)??'',/no-store/);
    const raw=await response.text();stack.assertNoCredentialLeaks(raw);for(const session of Object.values(sessions))session.assertNoCredentialLeaks(raw);
    // React separates adjacent SSR text nodes with comments; assert the visible copy.
    const text=raw.replace(/<!--[\s\S]*?-->/g,'');
    for(const account of Object.values(accounts))assert.ok(!text.includes(account.email));
    // Match the shared Auth fixture's bounded RSC negotiation. Do not follow
    // login redirects or treat the negotiation's empty body as a protected read.
    if(headers.RSC&&response.status===307&&response.headers.has('location')){
     const target=new URL(response.headers.get('location'),app.origin);
     assert.equal(target.origin,app.origin,'RSC negotiation stays on the owned app');
     if(target.pathname===new URL(path,app.origin).pathname&&target.searchParams.has('_rsc')){path=target.pathname+target.search;continue;}
    }
    return {response,text};
   }
   assert.fail('Flight page RSC negotiation did not settle');
  };
  await scenario('flight_ownership_indicator_uses_verified_viewer_in_feed_and_detail',async()=>{
   for(const [label,ownId,foreignId] of [['member',ids.own,ids.selected],['admin',ids.hidden,ids.c]]){
    const feed=await pageRead(label,'/dashboard/flights?dateFrom='+day+'&dateTo='+day);
    const card=id=>feed.text.match(new RegExp('<article[^>]*aria-labelledby="flight-'+id+'"[^>]*>([\\s\\S]*?)</article>'))?.[1];
    assert.ok(card(ownId),'Owned flight card is present');
    assert.ok(card(ownId).includes('Your flight'),'Only an owned card receives the text indicator');
    assert.ok(card(foreignId),'Permitted other-owner card is present');
    assert.ok(!card(foreignId).includes('Your flight'),'Visibility or admin role does not imply ownership');
    const own=await pageRead(label,'/dashboard/flights/'+ownId);assert.ok(own.text.includes('Your flight'));
    const other=await pageRead(label,'/dashboard/flights/'+foreignId);assert.ok(!other.text.includes('Your flight'));
   }
  });
  await scenario('flight_detail_session_authorization_and_safe_page_states',async()=>{
   const route=id=>'/dashboard/flights/'+id;
   const visible=await pageRead('member',route(ids.selected));
   assert.ok(visible.text.includes('Owned feed C172'));
   assert.ok(visible.text.includes('Posting pilot'));
   assert.ok(visible.text.includes('Owned Create Pilot'));
   assert.ok(visible.text.includes('/directory/'+accounts.admin.id));
   assert.ok(visible.text.includes(day+' at 19:00'));
   assert.ok(visible.text.includes('UTC-07:00'));
   assert.ok(visible.text.includes('No notes provided'));
   for(const [label,id] of [['member',ids.hidden],['noProfile',ids.selected],['admin',ids.own],['member',randomUUID()],['member','bad-id']]){
    const missing=await pageRead(label,route(id));
    assert.ok(missing.text.includes('Flight not found'));
    assert.ok(!missing.text.includes('Owned feed C172'));
    assert.ok(!missing.text.includes('private-feed-canary'));
   }
   for(const headers of [{},{RSC:'1'}]){
    const hidden=await pageRead('member',route(ids.hidden),headers);
    assert.ok(!hidden.text.includes('private-feed-canary'));
    assert.ok(!hidden.text.includes('Owned feed C172'));
   }
   assert.equal((await pageRead(null,route(ids.selected))).response.status,307);
   assert.ok((await pageRead('disabled',route(ids.selected))).text.includes('Access denied'));
   await control('disable-after-read:'+accounts.member.id);
   try{const revoked=await pageRead('member',route(ids.selected));assert.ok(revoked.text.includes('Access denied'));assert.ok(!revoked.text.includes('Owned feed C172'));}
   finally{await control('off');await stack.setMembership(accounts.member.id,{role:'member',status:'active'});}
   await control('outage');
   try{const failed=await pageRead('member',route(ids.selected));assert.ok(failed.text.includes('Flight temporarily unavailable'));assert.ok(!failed.text.includes('private-feed-error-canary'));}
   finally{await control('off');}
  });
  await scenario('flight_detail_notes_status_profile_fallback_and_recipient_revocation',async()=>{
   const route='/dashboard/flights/'+ids.selected;
   await checked(admin.from('flights').update({notes:'Detail notes\n<script>detail-xss-canary</script>'}).eq('id',ids.selected));
   const notes=await pageRead('member',route);
   assert.ok(notes.text.includes('Detail notes'),'Authorized detail retains fixture notes');
   assert.ok(notes.text.includes('&lt;script&gt;detail-xss-canary&lt;/script&gt;'),'Detail HTML escapes script-like notes');
   assert.ok(!notes.text.includes('<script>detail-xss-canary</script>'),'Detail never emits executable fixture notes');
   await stack.setMembership(accounts.admin.id,{role:'admin',status:'disabled'});
   try{const fallback=await pageRead('member',route);assert.ok(fallback.text.includes('Owned feed C172'),'Disabled posting pilot does not remove permitted flight');assert.ok(fallback.text.includes('Posting pilot information unavailable'),'Disabled posting pilot uses public-profile fallback');assert.ok(!fallback.text.includes('Owned Create Pilot'),'Disabled posting pilot profile stays hidden');}
   finally{await stack.setMembership(accounts.admin.id,{role:'admin',status:'active'});}
   for(const [key,heading] of [['cancelled','Cancelled flight'],['completed','Completed flight'],['past','Past departure']]){
    const page=await pageRead('member','/dashboard/flights/'+ids[key]);assert.ok(page.text.includes('Owned feed C172'),`${key}: authorized lifecycle detail remains visible`);assert.ok(page.text.includes(heading),`${key}: lifecycle heading rendered`);assert.ok(page.text.includes('no longer upcoming')||page.text.includes('not listed in upcoming flights'),`${key}: lifecycle notice rendered`);
    if(key==='past')assert.ok(!page.text.includes(' · Open'),'An elapsed open record is not presented as an upcoming open flight');
   }
   assert.ok(!notes.text.includes('id="flight-lifecycle"'),'Upcoming open details have no historical notice');
   const upcoming=await pageRead('member','/dashboard/flights');
   for(const key of ['past','cancelled','completed'])assert.ok(!upcoming.text.includes('/dashboard/flights/'+ids[key]),'Past and terminal records stay outside default upcoming results');
   await checked(admin.from('flights').update({departure_at:'2000-01-01T00:00:00Z',visibility:'PRIVATE'}).eq('id',ids.cancelled));
   const ownCancelled=await pageRead('member','/dashboard/flights/'+ids.cancelled);assert.ok(ownCancelled.text.includes('Cancelled flight'),'Owner retains cancelled PRIVATE detail');assert.ok(!ownCancelled.text.includes('Past departure'),'Stored cancellation takes precedence over elapsed departure');
   const unrelatedCancelled=await pageRead('admin','/dashboard/flights/'+ids.cancelled);assert.ok(unrelatedCancelled.text.includes('Flight not found'),'Unrelated admin receives safe missing cancelled PRIVATE detail');assert.ok(!unrelatedCancelled.text.includes('Cancelled flight'),'Terminal status grants no PRIVATE history bypass');
   await checked(admin.from('flight_recipients').delete().eq('flight_id',ids.selected).eq('user_id',accounts.member.id));
   try{const removed=await pageRead('member',route);assert.ok(removed.text.includes('Flight not found'),'Removed recipient receives safe missing detail');assert.ok(!removed.text.includes('Detail notes'),'Removed recipient cannot read prior flight notes');}
   finally{await checked(admin.from('flight_recipients').insert({flight_id:ids.selected,user_id:accounts.member.id}));}
   const feed=await pageRead('member','/dashboard/flights?dateFrom='+day);
   assert.ok(feed.text.includes('href="'+route+'"'),'Feed provides a real detail link');
  });
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

  // Exercise production pages with the same actors/sessions as the policy and
  // recipient-action fixtures. Distinct markers catch leaks in HTML and RSC.
  const visibilityKeys=['visibilityNetwork','visibilityPrivate','visibilityOther'];
  const markers=Object.fromEntries(visibilityKeys.map(key=>[key,'VOLO186-'+key]));
  const listing='/dashboard/flights?departureAirport=KSQL&destinationAirport=KSJC&dateFrom='+nextDay+'&dateTo='+nextDay;
  const assertPageVisibility=async(label,visibleKeys,gate='authorized')=>{
   for(const headers of [{},{RSC:'1'}]){
    for(const key of [null,...visibilityKeys]){
     const {response,text}=await pageRead(label,key?'/dashboard/flights/'+ids[key]:listing,headers);
     const context=`${label??'anonymous'} ${headers.RSC?'RSC':'HTML'} ${key??'listing'}`;
     if(gate==='anonymous'){
      if(headers.RSC){
       assert.equal(response.status,200,`${context}: streamed redirect status ${response.status}`);
       assert.match(response.headers.get('content-type')??'',/text\/x-component/);
       assert.ok(text.includes('NEXT_REDIRECT;replace;/login?reason=authentication-required;307;'),`${context}: fixed streamed login redirect`);
      }else{
       assert.equal(response.status,307,`${context}: redirect status ${response.status}`);
       assert.equal(new URL(response.headers.get('location'),app.origin).href,app.origin+'/login?reason=authentication-required',`${context}: unexpected login destination ${response.headers.get('location')}`);
      }
     }else{
      // Next's notFound() is HTTP404 for document reads; streamed RSC uses
      // HTTP200 with the not-found boundary. Both must omit the protected data.
      const expectedStatus=gate==='authorized'&&key&&!visibleKeys.includes(key)&&!headers.RSC?404:200;
      assert.equal(response.status,expectedStatus,`${context}: page status ${response.status}`);
      assert.match(response.headers.get('content-type')??'',headers.RSC?/text\/x-component/:/text\/html/,`${context}: representation type`);
      if(gate==='denied')assert.ok(text.includes('Access denied'));
      else if(key&&!visibleKeys.includes(key))assert.ok(text.includes('Flight not found'));
     }
     for(const candidate of visibilityKeys){
      const expected=gate==='authorized'&&visibleKeys.includes(candidate)&&(!key||key===candidate);
      assert.equal(text.includes(markers[candidate]),expected,`${label??'anonymous'} ${headers.RSC?'RSC':'HTML'} ${key??'listing'} visibility of ${candidate}`);
      if(!key&&!expected)assert.ok(!text.includes(ids[candidate]),'Hidden flight identifiers stay out of the listing payload');
     }
    }
   }
  };
  await scenario('flight_visibility_actual_pages_reuse_policy_actor_matrix',async()=>{
   for(const key of visibilityKeys)ids[key]=randomUUID();
   await checked(admin.from('flights').insert(visibilityKeys.map(key=>fixture(key,{
    departure_airport:'KSQL',destination_airport:'KSJC',departure_timezone:'UTC',
    visibility:key==='visibilityNetwork'?'NETWORK':'PRIVATE',aircraft_description:markers[key],
   }))));
   await checked(admin.from('flight_recipients').insert(['visibilityPrivate','visibilityOther'].map(key=>({flight_id:ids[key],user_id:accounts.admin.id}))));
   await assertPageVisibility('member',visibilityKeys); // Owner.
   await assertPageVisibility('admin',visibilityKeys); // Selected recipient.
   for(const label of ['noProfile','adminNoProfile'])await assertPageVisibility(label,['visibilityNetwork']);
   for(const label of ['disabled','absent'])await assertPageVisibility(label,[],'denied');
   await assertPageVisibility(null,[],'anonymous');
  });
  await scenario('flight_visibility_recipient_actions_revoke_and_restore_retained_page_sessions',async()=>{
   const change=async(selected,transport)=>{
    const response=await app.recipientAction(selected,{flight_id:ids.visibilityPrivate,recipient_id:accounts.admin.id},{session:sessions.member,transport});
    assert.equal(response.status,200);
    for(const header of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(response.headers.get(header)??'',/no-store/);
    const body=(await response.text()).replaceAll('&quot;','"');
    stack.assertNoCredentialLeaks(body);
    for(const session of Object.values(sessions))session.assertNoCredentialLeaks(body);
    for(const account of Object.values(accounts))assert.ok(!body.includes(account.email));
    assert.ok(body.includes('"code":"updated"'),'Real guarded recipient action confirms success');
   };
   // No re-login or cookie reset between warm reads and either mutation transport.
   for(const transport of ['native','fetched']){
    await change(false,transport);
    await assertPageVisibility('admin',['visibilityNetwork','visibilityOther']);
    await assertPageVisibility('member',visibilityKeys);
    await change(true,transport);
    await assertPageVisibility('admin',visibilityKeys);
   }
   // A retained selection cannot bypass disabled membership; reactivation can
   // restore that selection, but must never resurrect a removed selection.
   await stack.setMembership(accounts.admin.id,{role:'admin',status:'disabled'});
   try{await assertPageVisibility('admin',[],'denied');}
   finally{await stack.setMembership(accounts.admin.id,{role:'admin',status:'active'});}
   await assertPageVisibility('admin',visibilityKeys);
   await change(false,'fetched');
   await stack.setMembership(accounts.admin.id,{role:'admin',status:'disabled'});
   try{await assertPageVisibility('admin',[],'denied');}
   finally{await stack.setMembership(accounts.admin.id,{role:'admin',status:'active'});}
   await assertPageVisibility('admin',['visibilityNetwork','visibilityOther']);
  });

 }finally{
  await control('off');
  await checked(admin.from('flight_recipients').delete().in('flight_id',Object.values(ids)));
  await checked(admin.from('flights').delete().in('id',Object.values(ids)));
 }
}
