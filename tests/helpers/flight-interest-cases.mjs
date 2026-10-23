import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {signInSession} from './real-auth-session.mjs';
import {validateLocalApiUrl} from './local-auth-stack.mjs';

export async function verifyFlightInterest({stack,app,scenario}){
 validateLocalApiUrl(stack.apiUrl,Number(new URL(stack.apiUrl).port));
 const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);assert.equal(url.origin,stack.apiUrl);
  return fetch(input,{...init,redirect:'error',signal:init?.signal??AbortSignal.timeout(10000)});
 }}};
 const admin=createClient(stack.apiUrl,stack.serverSecret,options),accounts={},sessions={},clients={},flights=[];
 const checked=async query=>{const r=await query.retry(false);assert.equal(r.error,null,'Owned interest fixture operation');return r.data;};
 const rows=()=>checked(admin.from('flight_requests').select('*').in('flight_id',flights).order('id'));
 const mode=async value=>assert.equal((await app.request('/api/interest-control',{method:'POST',body:value})).status,200);
 const calls=async()=>(await(await app.request('/api/interest-control')).json()).calls;
 const checkScenario=(name,run)=>scenario(name,async()=>{await Promise.all(Object.values(sessions).map(s=>s.refresh()));await run();});
 async function newFlight(extra={}){
  const id=randomUUID();flights.push(id);
  await checked(admin.from('flights').insert({id,owner_id:accounts.owner.id,departure_airport:'KPAO',destination_airport:'KSQL',departure_at:new Date(Date.now()+86400000).toISOString(),departure_timezone:'UTC',aircraft_description:'Owned interest C172',pilot_places:1,visibility:'NETWORK',...extra}));
  return id;
 }
 async function invoke(label,flightId,extra={},settings={}){
  const response=await app.submitInterest({flight_id:flightId,...extra},{session:sessions[label],...settings});
  for(const field of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(response.headers.get(field)??'',/no-store/);
  const body=(await response.text()).replaceAll('&quot;','"');stack.assertNoCredentialLeaks(body);
  for(const s of Object.values(sessions))s.assertNoCredentialLeaks(body);
  for(const a of Object.values(accounts))assert.ok(!body.includes(a.email),'No account email in action result');
  assert.ok(!body.includes('private-interest-error-canary'));
  return {response,body};
 }
 const expectCode=(result,code)=>assert.ok(result.body.includes('"code":"'+code+'"'),'Interest result: '+code);
 async function deny(label,id,code,extra={},settings={}){
  const before=await rows(),beforeCalls=await calls();expectCode(await invoke(label,id,extra,settings),code);
  assert.deepEqual(await rows(),before,'Denied action leaves request records unchanged');
  assert.equal(await calls(),beforeCalls,'Application denial never calls submission RPC');
 }
 try{
  for(const [label,role,status,profile] of [['owner','member','active',true],['pilot','member','active',true],['other','admin','active',true],['disabled','member','disabled',true],['noProfile','member','active',false],['adminNoProfile','admin','active',false],['absent',null,'active',false]]){
   accounts[label]=await stack.createAccount({label:'interest-'+label.toLowerCase(),role,status});
   if(profile)await checked(admin.from('profiles').insert({user_id:accounts[label].id,display_name:'Owned interest pilot',home_airport:'KPAO',pilot_designation:'licensed'}));
   sessions[label]=await signInSession(stack,accounts[label]);
   clients[label]=createClient(stack.apiUrl,stack.publicKey,options);
   assert.equal((await clients[label].auth.signInWithPassword({email:accounts[label].email,password:accounts[label].password})).error,null);
  }
  const network=await newFlight(),privateFlight=await newFlight({visibility:'PRIVATE'});
  await checked(admin.from('flight_recipients').insert({flight_id:privateFlight,user_id:accounts.pilot.id}));
  await checkScenario('interest_native_and_fetched_actions_derive_requester',async()=>{
   expectCode(await invoke('pilot',network,{introductory_note:'Native hello'},{transport:'native'}),'submitted');
   expectCode(await invoke('pilot',privateFlight,{introductory_note:'Private hello'}),'submitted');
   const result=await rows();assert.equal(result.length,2);assert.ok(result.every(r=>r.requester_id===accounts.pilot.id&&r.status==='pending'));
   assert.equal(result.find(r=>r.flight_id===privateFlight).introductory_note,'Private hello');
  });
  await checkScenario('interest_action_current_access_origin_and_input_guards',async()=>{
   await deny(null,network,'unauthenticated');
   for(const label of ['disabled','absent'])await deny(label,network,'forbidden');
   for(const label of ['noProfile','adminNoProfile'])await deny(label,network,'profile_required');
   await deny('pilot',network,'forbidden',{}, {origin:null});
   for(const field of ['requester_id','owner_id','id','status','created_at','role'])await deny('pilot',network,'invalid_input',{[field]:'private-canary'});
   await deny('pilot',network,'invalid_input',{introductory_note:'N'.repeat(501)});
   await deny('pilot',network,'too_large',{introductory_note:'N'.repeat(5000)});
  });
  await checkScenario('interest_duplicate_and_withdrawn_resubmission_preserve_identity',async()=>{
   const before=(await rows()).find(r=>r.flight_id===network);
   expectCode(await invoke('pilot',network,{introductory_note:'Do not overwrite'}),'already_requested');
   assert.deepEqual((await rows()).find(r=>r.id===before.id),before);
   await checked(admin.from('flight_requests').update({status:'withdrawn'}).eq('id',before.id));
   expectCode(await invoke('pilot',network,{introductory_note:'Resubmitted hello'}),'submitted');
   const after=(await rows()).find(r=>r.id===before.id);assert.equal(after.created_at,before.created_at);assert.equal(after.introductory_note,'Resubmitted hello');assert.equal(after.status,'pending');
   await checked(admin.from('flight_requests').update({status:'declined'}).eq('id',before.id));
   expectCode(await invoke('pilot',network),'request_closed');
   assert.equal((await rows()).length,2);
  });
  await checkScenario('interest_unavailable_flights_and_private_bypasses_are_safe',async()=>{
   for(const id of [network,privateFlight,randomUUID(),await newFlight({status:'cancelled'}),await newFlight({status:'completed'}),await newFlight({departure_at:'2000-01-01T00:00Z'})]){
    const label=id===network?'owner':'other';expectCode(await invoke(label,id),'flight_unavailable');
   }
   const direct=await clients.other.rpc('submit_flight_interest',{p_flight_id:privateFlight}).retry(false);
   assert.equal(direct.error,null);assert.deepEqual(direct.data,{code:'flight_unavailable'});
   assert.deepEqual((await checked(clients.other.from('flight_requests').select('id'))),[]);
  });
  await checkScenario('interest_full_flight_blocks_new_and_resubmitted_interest',async()=>{
   const id=await newFlight();expectCode(await invoke('pilot',id),'submitted');expectCode(await invoke('other',id),'submitted');
   const pending=(await rows()).filter(r=>r.flight_id===id),pilot=pending.find(r=>r.requester_id===accounts.pilot.id),other=pending.find(r=>r.requester_id===accounts.other.id);
   await checked(admin.from('flight_requests').update({status:'withdrawn'}).eq('id',pilot.id));
   await checked(admin.from('flight_requests').update({status:'accepted'}).eq('id',other.id));
   expectCode(await invoke('pilot',id),'flight_unavailable');
   expectCode(await invoke('other',id),'already_requested');
   assert.equal((await rows()).find(r=>r.id===pilot.id).status,'withdrawn');
  });
  await checkScenario('interest_direct_rpc_enforces_final_identity_and_profile_checks',async()=>{
   const id=await newFlight();const before=await rows();
   for(const label of ['disabled','absent','noProfile','adminNoProfile'])assert.equal((await clients[label].rpc('submit_flight_interest',{p_flight_id:id}).retry(false)).error?.code,'42501');
   const anon=createClient(stack.apiUrl,stack.publicKey,options);assert.equal((await anon.rpc('submit_flight_interest',{p_flight_id:id}).retry(false)).error?.code,'42501');
   assert.equal((await clients.pilot.rpc('submit_flight_interest',{p_flight_id:id,p_requester_id:accounts.other.id}).retry(false)).error?.code,'PGRST202');
   assert.equal((await clients.pilot.from('flight_requests').insert({flight_id:id,requester_id:accounts.pilot.id}).retry(false)).error?.code,'42501');
   assert.deepEqual(await rows(),before);
   await mode('disable:'+accounts.pilot.id);
   try{expectCode(await invoke('pilot',id),'forbidden');}finally{await mode('off');await stack.setMembership(accounts.pilot.id,{role:'member',status:'active'});}
   assert.deepEqual(await rows(),before,'Disablement after server prechecks creates no interest');
  });
  await checkScenario('interest_final_sql_capacity_check_catches_stale_server_state',async()=>{
   const id=await newFlight();expectCode(await invoke('other',id),'submitted');
   const pending=(await rows()).find(r=>r.flight_id===id);await mode('full:'+pending.id);
   try{expectCode(await invoke('pilot',id),'flight_unavailable');}finally{await mode('off');}
   assert.equal((await rows()).filter(r=>r.flight_id===id).length,1);
  });
  await checkScenario('interest_uncertain_confirmation_does_not_retry_or_leak_errors',async()=>{
   for(const failure of ['lost','malformed']){
    const id=await newFlight(),beforeCalls=await calls();await mode(failure);
    try{expectCode(await invoke('pilot',id),'unavailable');}finally{await mode('off');}
    assert.equal(await calls(),beforeCalls+1,'Uncertain write never retries');
    assert.equal((await rows()).filter(r=>r.flight_id===id).length,1,'One committed row despite missing confirmation');
    expectCode(await invoke('pilot',id),'already_requested');
   }
  });
  const page=async(id,label='pilot')=>{
   const response=await app.request('/dashboard/flights/'+id,{session:sessions[label]});
   for(const field of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(response.headers.get(field)??'',/no-store/);
   const html=await response.text(),body=html.replaceAll('&quot;','"');stack.assertNoCredentialLeaks(body);
   for(const session of Object.values(sessions))session.assertNoCredentialLeaks(body);
   assert.ok(!body.includes('private-interest-error-canary'));
   return {response,body,html};
  };
  const pageAction=async(id,fields={},settings={})=>{
   const response=await app.interestPageAction(id,fields,{session:sessions.pilot,transport:'native',...settings});
   for(const field of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(response.headers.get(field)??'',/no-store/);
   const body=(await response.text()).replaceAll('&quot;','"');stack.assertNoCredentialLeaks(body);
   for(const session of Object.values(sessions))session.assertNoCredentialLeaks(body);
   assert.ok(!body.includes('private-interest-error-canary'));return body;
  };
  const hasForm=body=>/<textarea[^>]*name="introductory_note"/.test(body);
  await checkScenario('incoming_owner_list_states_profile_fallback_and_foreign_owner_isolation',async()=>{
   const id=await newFlight(),note='incoming-owner-only-note-canary';
   assert.match((await page(id,'owner')).body,/No requests yet/);
   expectCode(await invoke('pilot',id,{introductory_note:note}),'submitted');
   for(const state of ['pending','accepted','cancelled']){
    if(state!=='pending')await checked(admin.from('flight_requests').update({status:state}).eq('flight_id',id));
    const body=(await page(id,'owner')).body;assert.match(body,/Incoming pilot requests/);assert.ok(body.includes(note));
    assert.ok(body.includes(state[0].toUpperCase()+state.slice(1)));assert.match(body,/View pilot profile/);assert.match(body,/Home airport: /);
    for(const account of Object.values(accounts))assert.ok(!body.includes(account.email),'No account emails in owner HTML/RSC');
   }
   // An unrelated administrator who owns another flight has no request-list bypass.
   await newFlight({owner_id:accounts.other.id});
   const unrelated=(await page(id,'other')).body;assert.ok(!unrelated.includes(note));assert.ok(!unrelated.includes('Incoming pilot requests'));
   assert.deepEqual(await checked(clients.other.from('flight_requests').select('id').eq('flight_id',id)),[]);
   await stack.setMembership(accounts.pilot.id,{role:'member',status:'disabled'});
   try{const body=(await page(id,'owner')).body;assert.ok(body.includes(note));assert.match(body,/Pilot profile unavailable/);assert.ok(!body.includes('/directory/'+accounts.pilot.id));}
   finally{await stack.setMembership(accounts.pilot.id,{role:'member',status:'active'});}
   await mode('profile-timeout:'+accounts.pilot.id);
   try{const body=(await page(id,'owner')).body;assert.ok(body.includes(note),'Profile timeout preserves readable requests');assert.match(body,/Pilot profile unavailable/);assert.ok(!body.includes('Incoming requests are temporarily unavailable'));}
   finally{await mode('off');}
  });
  await checkScenario('incoming_newest_first_pages_preserve_all_requests_and_reject_bad_cursors',async()=>{
   const id=await newFlight(),requesters=[accounts.pilot.id,accounts.other.id];
   for(let n=0;n<19;n++){
    const label='incoming-page-'+n,account=await stack.createAccount({label,role:'member',status:'active'});accounts[label]=account;
    await checked(admin.from('profiles').insert({user_id:account.id,display_name:'Incoming page pilot '+n,home_airport:'KPAO',pilot_designation:'licensed'}));requesters.push(account.id);
   }
   await checked(admin.from('flight_requests').insert(requesters.map((requester_id,n)=>({flight_id:id,requester_id,introductory_note:'Pagination introduction '+String(n).padStart(2,'0')+' end'}))));
   const ordered=await checked(admin.from('flight_requests').select('introductory_note').eq('flight_id',id).order('created_at',{ascending:false}).order('id',{ascending:false}));
   const first=(await page(id,'owner')).body;
   for(const row of ordered.slice(0,20))assert.ok(first.includes(row.introductory_note));assert.ok(!first.includes(ordered[20].introductory_note));
   const next=first.match(/<a[^>]*href="([^"]+)"[^>]*>Next requests<\/a>/)?.[1];assert.ok(next,'Owner receives an actual next-page link');
   const response=await app.request(next.replaceAll('&amp;','&'),{session:sessions.owner}),second=await response.text();
   assert.ok(second.includes(ordered[20].introductory_note));for(const row of ordered.slice(0,20))assert.ok(!second.includes(row.introductory_note));assert.ok(!second.includes('>Next requests<'));
   const invalid=await app.request('/dashboard/flights/'+id+'?requestsAfter=invalid',{session:sessions.owner});assert.match(await invalid.text(),/request page link is invalid/);
  });
  await checkScenario('incoming_request_outage_is_safe_and_recovers',async()=>{
   const id=await newFlight();expectCode(await invoke('pilot',id,{introductory_note:'incoming-outage-secret-note'}),'submitted');await mode('read-outage');
   try{const body=(await page(id,'owner')).body;assert.match(body,/Incoming requests are temporarily unavailable/);assert.ok(!body.includes('incoming-outage-secret-note'));assert.match(body,/Try again/);}finally{await mode('off');}
   assert.ok((await page(id,'owner')).body.includes('incoming-outage-secret-note'));
  });
  await checkScenario('interest_detail_native_submission_and_pending_reload',async()=>{
   const id=await newFlight();const initial=await page(id);assert.equal(initial.response.status,200);assert.ok(hasForm(initial.body));
   assert.match(initial.body,/Introduction \(optional\)/);assert.match(initial.body,/Up to 500 characters/);
   const result=await pageAction(id,{introductory_note:'Hello from the detail page'});assert.match(result,/Request pending/);
   assert.ok(!hasForm((await page(id)).body),'Pending reload has no repeat-submit form');
   const records=(await rows()).filter(r=>r.flight_id===id);assert.equal(records.length,1);assert.equal(records[0].introductory_note,'Hello from the detail page');assert.equal(records[0].requester_id,accounts.pilot.id);
  });
  await checkScenario('interest_stale_detail_forms_concurrently_confirm_one_request',async()=>{
   for(const initial of ['none','withdrawn']){
    const id=await newFlight();let prior;
    if(initial==='withdrawn'){
     expectCode(await invoke('pilot',id,{introductory_note:'Previous withdrawn introduction'}),'submitted');
     prior=(await rows()).find(r=>r.flight_id===id);
     await checked(admin.from('flight_requests').update({status:'withdrawn'}).eq('id',prior.id));
    }
    // Independent HTTP requests model two already-open tabs. Next's single-client
    // dispatcher intentionally serializes actions, so do not test its queue.
    const cached=await Promise.all([page(id),page(id)]);assert.ok(cached.every(p=>hasForm(p.body)));
    const beforeCalls=await calls();
    const notes=['First stale-tab introduction','Second stale-tab introduction'];
    const responses=await Promise.all(cached.map((p,index)=>pageAction(id,{introductory_note:notes[index]},{transport:index===0?'native':'fetched',formHtml:p.html})));
    for(const body of responses){assert.match(body,/Request pending/);assert.ok(!body.includes('Unable to confirm your request'));assert.ok(!body.includes('Check your introduction'));}
    const records=(await rows()).filter(r=>r.flight_id===id);assert.equal(records.length,1,'Concurrent stale forms retain one flight/requester record');
    const record=records[0];assert.equal(record.status,'pending');assert.ok(notes.includes(record.introductory_note));assert.equal(await calls(),beforeCalls+2,'One guarded operation per explicit tab submission');
    if(prior){assert.equal(record.id,prior.id);assert.equal(record.created_at,prior.created_at);}
    else assert.equal(record.updated_at,record.created_at,'Losing duplicate cannot touch original timestamps');
    assert.ok(!hasForm((await page(id)).body),'Reload suppresses duplicate submit control');
    const retried=await pageAction(id,{introductory_note:'Do not overwrite the winning introduction'},{transport:'fetched',formHtml:cached[1].html});assert.match(retried,/Request pending/);
    assert.deepEqual((await rows()).find(r=>r.id===record.id),record,'Explicit stale retry cannot rewrite the winning record');
    await checked(admin.from('flight_requests').update({status:'accepted'}).eq('id',record.id));
    const accepted=(await rows()).find(r=>r.id===record.id);
    assert.match(await pageAction(id,{}, {formHtml:cached[0].html}),/Your request has been accepted/);
    assert.deepEqual((await rows()).find(r=>r.id===record.id),accepted,'Stale accepted submission stays accepted without mutation');
    await checked(admin.from('flight_requests').update({status:'cancelled'}).eq('id',record.id));
    const cancelled=(await rows()).find(r=>r.id===record.id);
    assert.match(await pageAction(id,{}, {formHtml:cached[0].html}),/closed and cannot be submitted again/);
    assert.deepEqual((await rows()).find(r=>r.id===record.id),cancelled,'Terminal record is not revived by cached form submission');
   }
  });
  await checkScenario('interest_detail_own_unavailable_and_profile_required_states',async()=>{
   const id=await newFlight();assert.ok(!hasForm((await page(id,'owner')).body),'Owner cannot request own flight');
   const profile=await page(id,'adminNoProfile');assert.ok(!hasForm(profile.body));assert.match(profile.body,/Complete your pilot profile/);
   assert.match(profile.body,/<a[^>]*href="\/onboarding"[^>]*>Complete your pilot profile<\/a>/);
   const edit=await app.request('/onboarding',{session:sessions.adminNoProfile});assert.equal(edit.status,200);assert.match(await edit.text(),/display_name/);
   for(const extra of [{status:'cancelled'},{status:'completed'},{departure_at:'2000-01-01T00:00Z'}]){
    const body=(await page(await newFlight(extra))).body;assert.ok(!hasForm(body));assert.match(body,/unavailable for new interest/);
   }
  });
  await checkScenario('interest_detail_validation_resubmission_and_terminal_feedback',async()=>{
   const id=await newFlight();const invalid=await pageAction(id,{introductory_note:'N'.repeat(501)});
   assert.match(invalid,/Check your introduction/);assert.ok(hasForm(invalid));assert.equal((await rows()).filter(r=>r.flight_id===id).length,0);
   const submitted=await pageAction(id,{introductory_note:'Fetched detail hello'},{transport:'fetched'});assert.match(submitted,/Request pending/);
   const record=(await rows()).find(r=>r.flight_id===id);
   await checked(admin.from('flight_requests').update({status:'withdrawn'}).eq('id',record.id));
   assert.match((await page(id)).body,/Submit interest again/);
   assert.match(await pageAction(id,{introductory_note:'Second introduction'}),/Request pending/);
   assert.equal((await rows()).find(r=>r.flight_id===id).id,record.id);
   await checked(admin.from('flight_requests').update({status:'accepted'}).eq('id',record.id));
   const accepted=(await page(id)).body;assert.match(accepted,/Your request has been accepted/);assert.ok(!hasForm(accepted));
   await checked(admin.from('flight_requests').update({status:'cancelled'}).eq('id',record.id));
   const closed=(await page(id)).body;assert.match(closed,/closed and cannot be submitted again/);assert.ok(!hasForm(closed));
  });
  await checkScenario('interest_detail_full_and_uncertain_results_prevent_repeat_submission',async()=>{
   const full=await newFlight();expectCode(await invoke('other',full),'submitted');
   await checked(admin.from('flight_requests').update({status:'accepted'}).eq('flight_id',full));
   assert.match(await pageAction(full),/unavailable for new interest/);assert.equal((await rows()).filter(r=>r.flight_id===full).length,1);
   const id=await newFlight(),beforeCalls=await calls();await mode('lost');let uncertain;
   try{uncertain=await pageAction(id,{introductory_note:'Keep this introduction'});}finally{await mode('off');}
   assert.match(uncertain,/Unable to confirm your request/);assert.match(uncertain,/Keep this introduction/);assert.match(uncertain,/<fieldset[^>]*disabled/);assert.match(uncertain,/Check request status/);
   assert.equal(await calls(),beforeCalls+1);const reloaded=(await page(id)).body;assert.match(reloaded,/Request pending/);assert.ok(!hasForm(reloaded));
  });
  await checkScenario('interest_detail_private_bypass_and_removed_history_never_expose_flight',async()=>{
   const id=await newFlight({visibility:'PRIVATE',notes:'private-detail-interest-canary'}),source=await newFlight();
   await checked(admin.from('flight_recipients').insert({flight_id:id,user_id:accounts.pilot.id}));
   const denied=(await page(id,'other')).body;assert.ok(!hasForm(denied));assert.ok(!denied.includes('private-detail-interest-canary'));
   const bypass=await pageAction(id,{}, {session:sessions.other,fromFlightId:source});assert.ok(!bypass.includes('private-detail-interest-canary'));assert.equal((await rows()).filter(r=>r.flight_id===id).length,0);
   assert.match(await pageAction(id,{introductory_note:'Selected private pilot'}),/Request pending/);
   await checked(clients.owner.rpc('change_flight_recipient',{p_flight_id:id,p_recipient_id:accounts.pilot.id,p_selected:false}));
   const removed=(await page(id)).body;assert.ok(!hasForm(removed));assert.ok(!removed.includes('private-detail-interest-canary'));
   const history=await checked(clients.pilot.from('flight_requests').select('status').eq('flight_id',id));assert.deepEqual(history,[{status:'cancelled'}]);
  });
  await checkScenario('interest_detail_status_outage_fails_closed_with_reload_recovery',async()=>{
   const id=await newFlight();await mode('read-outage');
   try{const body=(await page(id)).body;assert.match(body,/Request status temporarily unavailable/);assert.ok(!hasForm(body));assert.match(body,/Check request status/);}finally{await mode('off');}
   assert.ok(hasForm((await page(id)).body));
  });
 }finally{
  await mode('off');
  if(flights.length){
   await checked(admin.from('flight_requests').delete().in('flight_id',flights));
   await checked(admin.from('flight_recipients').delete().in('flight_id',flights));
   await checked(admin.from('flights').delete().in('id',flights));
  }
  for(const account of Object.values(accounts))await stack.removeOwnedProfile(account.id);
  for(const client of Object.values(clients))await client.auth.stopAutoRefresh();
 }
}
