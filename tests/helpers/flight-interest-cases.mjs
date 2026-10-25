import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
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
 const checkScenario=(name,run)=>scenario(name,async()=>{try{await Promise.all(Object.values(sessions).map(s=>s.refresh()));await run();}catch(error){error.operation??=error.name;throw error;}});
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
  const connectionMode=async value=>assert.equal((await app.request('/api/connection-control',{method:'POST',body:value})).status,200);
  const connection=async(request,label='pilot')=>{
   const response=await app.request('/api/flight-connection?request='+encodeURIComponent(request),{session:sessions[label]});
   for(const name of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(response.headers.get(name)??'',/no-store/);
   const body=await response.text();stack.assertNoCredentialLeaks(body);for(const s of Object.values(sessions))s.assertNoCredentialLeaks(body);
   for(const a of Object.values(accounts))assert.ok(!body.includes(a.email));assert.ok(!body.includes('private-connection-error-canary'));return JSON.parse(body);
  };
  const acceptedConnection=async(extra={})=>{
   const id=await newFlight(extra);if(extra.visibility==='PRIVATE')await checked(admin.from('flight_recipients').insert({flight_id:id,user_id:accounts.pilot.id}));
   expectCode(await invoke('pilot',id,{introductory_note:'connection-private-note-canary'}),'submitted');
   const request=(await rows()).find(r=>r.flight_id===id);await checked(clients.owner.rpc('decide_flight_request',{p_flight_id:id,p_request_id:request.id,p_decision:'accepted'}));return {id,request};
  };
  await checkScenario('connection_real_session_only_approved_pair_without_admin_or_pending_bypass',async()=>{
   const {id,request}=await acceptedConnection({visibility:'PRIVATE',pilot_places:2});
   await checked(admin.from('flight_recipients').insert({flight_id:id,user_id:accounts.other.id}));expectCode(await invoke('other',id),'submitted');
   const snapshot=await rows();
   for(const label of ['owner','pilot']){
    const result=await connection(request.id,label);assert.equal(result.status,'authorized');assert.deepEqual(result.connection,{requestId:request.id,flightId:id,ownerId:accounts.owner.id,requesterId:accounts.pilot.id,counterpartId:label==='owner'?accounts.pilot.id:accounts.owner.id,isOwner:label==='owner'});
    assert.ok(!JSON.stringify(result).includes('connection-private-note-canary'));
   }
   for(const label of ['other','adminNoProfile','noProfile'])assert.deepEqual(await connection(request.id,label),{status:'missing'});
   assert.deepEqual(await connection(request.id,null),{status:'unauthenticated'});for(const label of ['disabled','absent'])assert.deepEqual(await connection(request.id,label),{status:'forbidden'});
   for(const id of ['invalid',randomUUID()])assert.deepEqual(await connection(id),{status:'missing'});
   assert.equal(await checked(clients.other.rpc('get_flight_connection',{p_request_id:request.id})),null,'Direct ordinary RPC has no admin/pending bypass');
   assert.deepEqual(await rows(),snapshot,'Connection reads do not alter requests');
  });
  await checkScenario('connection_live_membership_withdrawal_resubmission_cancellation_and_private_removal',async()=>{
   const {id,request}=await acceptedConnection();
   await stack.setMembership(accounts.pilot.id,{role:'member',status:'disabled'});
   try{assert.deepEqual(await connection(request.id,'owner'),{status:'missing'});assert.deepEqual(await connection(request.id),{status:'forbidden'});}finally{await stack.setMembership(accounts.pilot.id,{role:'member',status:'active'});}
   await stack.setMembership(accounts.owner.id,{role:'member',status:'disabled'});
   try{assert.deepEqual(await connection(request.id),{status:'missing'});}finally{await stack.setMembership(accounts.owner.id,{role:'member',status:'active'});}
   assert.equal((await connection(request.id)).status,'authorized');
   await checked(clients.pilot.rpc('withdraw_flight_request',{p_flight_id:id,p_request_id:request.id}));assert.deepEqual(await connection(request.id),{status:'missing'});
   expectCode(await invoke('pilot',id),'submitted');assert.deepEqual(await connection(request.id),{status:'missing'});
   await checked(clients.owner.rpc('decide_flight_request',{p_flight_id:id,p_request_id:request.id,p_decision:'accepted'}));assert.equal((await connection(request.id)).status,'authorized');
   await checked(clients.owner.rpc('cancel_flight',{p_flight_id:id}));assert.deepEqual(await connection(request.id),{status:'missing'});
   const privatePair=await acceptedConnection({visibility:'PRIVATE'});await checked(clients.owner.rpc('change_flight_recipient',{p_flight_id:privatePair.id,p_recipient_id:accounts.pilot.id,p_selected:false}));
   for(const label of ['owner','pilot'])assert.deepEqual(await connection(privatePair.request.id,label),{status:'missing'});
   assert.deepEqual(await checked(clients.pilot.from('flight_requests').select('status').eq('id',privatePair.request.id)),[{status:'cancelled'}],'Read-only retained history remains separate');
  });
  await checkScenario('connection_rechecks_mid_read_closure_and_viewer_revocation_and_sanitizes_provider',async()=>{
   const {request}=await acceptedConnection();await connectionMode('withdraw:'+request.id);
   try{assert.deepEqual(await connection(request.id),{status:'missing'});}finally{await connectionMode('off');}
   assert.equal((await rows()).find(r=>r.id===request.id).status,'withdrawn');
   const next=await acceptedConnection();await connectionMode('disable:'+accounts.pilot.id);
   try{assert.deepEqual(await connection(next.request.id),{status:'forbidden'});}finally{await connectionMode('off');await stack.setMembership(accounts.pilot.id,{role:'member',status:'active'});}
   await connectionMode('malformed');try{assert.deepEqual(await connection(next.request.id),{status:'unavailable'});}finally{await connectionMode('off');}
   assert.equal((await connection(next.request.id)).status,'authorized');
  });
  const connectionPage=async(request,label='pilot')=>{
   const response=await app.request('/dashboard/connections/'+request,{session:sessions[label]});
   for(const name of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(response.headers.get(name)??'',/no-store/);
   const body=await response.text();stack.assertNoCredentialLeaks(body);for(const s of Object.values(sessions))s.assertNoCredentialLeaks(body);for(const a of Object.values(accounts))assert.ok(!body.includes(a.email));assert.ok(!body.includes('private-connection-error-canary'));return body;
  };
  await checkScenario('connection_page_both_pilots_receive_bound_flight_counterpart_and_entry_links',async()=>{
   await checked(admin.from('profiles').update({display_name:'Posting connection pilot',bio:'Owner permitted biography'}).eq('user_id',accounts.owner.id));
   await checked(admin.from('profiles').update({display_name:'Joining connection pilot',bio:'Requester permitted biography'}).eq('user_id',accounts.pilot.id));
   try{
    const {id,request}=await acceptedConnection({visibility:'PRIVATE',notes:'connection-view-flight-canary'});
    for(const [label,name,bio,role] of [['owner','Joining connection pilot','Requester permitted biography','Joining pilot'],['pilot','Posting connection pilot','Owner permitted biography','Posting pilot']]){
     const body=await connectionPage(request.id,label);assert.match(body,/Accepted connection/);assert.ok(body.includes(name)&&body.includes(bio)&&body.includes(role));assert.match(body,/connection-view-flight-canary/);assert.match(body,/UTC/);assert.match(body,/Owned interest C172/);assert.ok(body.includes('href="/dashboard/flights/'+id+'"'));assert.ok(!body.includes('Send message'));
     const source=(await page(id,label)).body;assert.ok(source.includes('href="/dashboard/connections/'+request.id+'"'));assert.match(source,/View accepted connection/);
    }
    assert.match(await connectionPage(request.id,'owner'),/You are the posting pilot/);assert.match(await connectionPage(request.id),/Your request has been accepted/);
   }finally{
    await checked(admin.from('profiles').update({display_name:'Owned interest pilot',bio:null}).in('user_id',[accounts.owner.id,accounts.pilot.id]));
   }
  });
  await checkScenario('connection_page_pending_unrelated_closed_and_revoked_views_discard_private_details',async()=>{
   const {id,request}=await acceptedConnection({visibility:'PRIVATE',notes:'connection-closed-private-canary'});
   for(const label of ['other','adminNoProfile','noProfile','disabled','absent']){const body=await connectionPage(request.id,label);assert.ok(!body.includes('connection-closed-private-canary'));assert.ok(!body.includes('Owned interest C172'));}
   assert.match(await connectionPage('invalid'),/Connection unavailable/);assert.match(await connectionPage(randomUUID()),/Connection unavailable/);
   const pending=await newFlight({notes:'pending-connection-canary'});expectCode(await invoke('pilot',pending),'submitted');const pendingRow=(await rows()).find(r=>r.flight_id===pending);
   assert.ok(!(await page(pending)).body.includes('View accepted connection'));for(const label of ['owner','pilot']){const body=await connectionPage(pendingRow.id,label);assert.match(body,/Connection unavailable/);assert.ok(!body.includes('pending-connection-canary'));}
   await checked(clients.owner.rpc('change_flight_recipient',{p_flight_id:id,p_recipient_id:accounts.pilot.id,p_selected:false}));for(const label of ['owner','pilot']){const body=await connectionPage(request.id,label);assert.match(body,/Request cancelled/);assert.ok(!body.includes('connection-closed-private-canary'));assert.match(body,/connection-private-note-canary/);assert.equal(body.includes('Owned interest C172'),label==='owner');assert.ok(!body.includes('View accepted connection'));}
   for(const close of ['withdraw','cancel','complete']){
    const pair=await acceptedConnection({notes:'closed-connection-canary'});
    if(close==='withdraw')await checked(clients.pilot.rpc('withdraw_flight_request',{p_flight_id:pair.id,p_request_id:pair.request.id}));
    else if(close==='cancel')await checked(clients.owner.rpc('cancel_flight',{p_flight_id:pair.id}));else await checked(admin.from('flights').update({status:'completed'}).eq('id',pair.id));
    for(const label of ['owner','pilot']){const body=await connectionPage(pair.request.id,label);assert.match(body,close==='complete'?/Connection unavailable/:close==='withdraw'?/Request withdrawn/:/Request cancelled/);assert.ok(!body.includes('closed-connection-canary'));assert.ok(!body.includes('Send message'));if(close!=='complete'){assert.match(body,/Request history/);assert.match((await page(pair.id,label)).body,/View closed request/);}}
   }
  });
  await checkScenario('connection_page_optional_profile_failure_recovery_and_final_authorization_recheck',async()=>{
   const pair=await acceptedConnection({notes:'optional-profile-flight-note'});await mode('profile-timeout:'+accounts.pilot.id);
   try{const body=await connectionPage(pair.request.id,'owner');assert.match(body,/Pilot profile temporarily unavailable/);assert.match(body,/optional-profile-flight-note/);}finally{await mode('off');}
   assert.ok((await connectionPage(pair.request.id,'owner')).includes('/directory/'+accounts.pilot.id));
   await connectionMode('malformed');try{const body=await connectionPage(pair.request.id);assert.match(body,/Connection temporarily unavailable/);assert.match(body,/Check connection status/);assert.ok(!body.includes('optional-profile-flight-note'));}finally{await connectionMode('off');}
   await connectionMode('withdraw-profile:'+pair.request.id);try{const body=await connectionPage(pair.request.id,'owner');assert.match(body,/Request withdrawn/);assert.ok(!body.includes('optional-profile-flight-note'));assert.ok(!body.includes('/directory/'+accounts.pilot.id));}finally{await connectionMode('off');}
   assert.equal((await rows()).find(r=>r.id===pair.request.id).status,'withdrawn');
  });
  await checkScenario('closed_connection_history_is_read_only_and_resubmission_requires_fresh_acceptance',async()=>{
   const pair=await acceptedConnection();
   await checked(clients.pilot.rpc('withdraw_flight_request',{p_flight_id:pair.id,p_request_id:pair.request.id}));
   for(const label of ['owner','pilot']){const body=await connectionPage(pair.request.id,label);assert.match(body,/Request withdrawn/);assert.match(body,/connection-private-note-canary/);assert.match(body,/fresh acceptance/);assert.ok(!body.includes('>Accept<')&&!body.includes('>Withdraw request<')&&!body.includes('>Send message<'));}
   for(const label of ['other','adminNoProfile','disabled','absent']){const body=await connectionPage(pair.request.id,label);assert.ok(!body.includes('Request history'));assert.ok(!body.includes('connection-private-note-canary'));assert.ok(!body.includes('Owned interest C172'));}
   assert.deepEqual(await connection(pair.request.id),{status:'missing'});
   expectCode(await invoke('pilot',pair.id,{introductory_note:'Fresh introduction'}),'submitted');
   for(const label of ['owner','pilot'])assert.match(await connectionPage(pair.request.id,label),/Connection unavailable/);
   assert.deepEqual(await connection(pair.request.id),{status:'missing'});
   await checked(clients.owner.rpc('decide_flight_request',{p_flight_id:pair.id,p_request_id:pair.request.id,p_decision:'accepted'}));
   assert.match(await connectionPage(pair.request.id),/Accepted connection/);
   const before=await rows();await connectionPage(pair.request.id);assert.deepEqual(await rows(),before,'Connection views never mutate requests');
  });
  await checkScenario('conversation_real_session_pair_binding_private_history_and_fresh_acceptance',async()=>{
   const {id,request}=await acceptedConnection({visibility:'PRIVATE',notes:'conversation-private-flight-canary'});
   const open=label=>clients[label].rpc('get_or_create_flight_conversation',{p_request_id:request.id}).retry(false);
   for(const label of ['other','adminNoProfile','noProfile','disabled','absent'])assert.equal((await open(label)).error?.code,'42501');
   const created=await open('pilot');assert.equal(created.error,null);assert.match(created.data,/^[a-f0-9-]{36}$/);assert.equal((await open('owner')).data,created.data);
   const stored=await checked(clients.pilot.from('conversations').select('*').eq('id',created.data));assert.equal(stored.length,1);assert.equal(stored[0].owner_id,accounts.owner.id);assert.equal(stored[0].requester_id,accounts.pilot.id);assert.equal(stored[0].flight_request_id,request.id);assert.equal(stored[0].closed_at,null);
   assert.deepEqual(await checked(clients.other.from('conversations').select('*').eq('id',created.data)),[]);
   assert.equal((await clients.pilot.from('conversations').update({owner_id:accounts.other.id}).eq('id',created.data).retry(false)).error?.code,'42501');
   await checked(clients.pilot.rpc('withdraw_flight_request',{p_flight_id:id,p_request_id:request.id}));assert.equal((await open('pilot')).error?.code,'42501');
   assert.ok((await checked(clients.owner.from('conversations').select('closed_at').eq('id',created.data).single())).closed_at);
   expectCode(await invoke('pilot',id),'submitted');assert.equal((await open('pilot')).error?.code,'42501');
   await checked(clients.owner.rpc('decide_flight_request',{p_flight_id:id,p_request_id:request.id,p_decision:'accepted'}));assert.equal((await open('pilot')).data,created.data);
   await checked(clients.owner.rpc('change_flight_recipient',{p_flight_id:id,p_recipient_id:accounts.pilot.id,p_selected:false}));assert.equal((await open('pilot')).error?.code,'42501');
   assert.deepEqual(await checked(clients.pilot.from('flights').select('id').eq('id',id)),[]);
   assert.ok((await checked(clients.pilot.from('conversations').select('closed_at').eq('id',created.data).single())).closed_at);
  });
  await checkScenario('message_real_session_history_is_participant_only_and_all_direct_writes_are_closed',async()=>{
   const {id,request}=await acceptedConnection({visibility:'PRIVATE'});
   const thread=await checked(clients.pilot.rpc('get_or_create_flight_conversation',{p_request_id:request.id}));
   const message=randomUUID(),body="Owned plain message: <script>text only</script> and pilot's introduction";
   await stack.createOwnedMessage({id:message,conversation:thread,sender:accounts.pilot.id,body});
   for(const label of ['owner','pilot'])assert.deepEqual(await checked(clients[label].from('messages').select('id,sender_id,body').eq('conversation_id',thread)),[{id:message,sender_id:accounts.pilot.id,body}]);
   for(const label of ['other','adminNoProfile','noProfile','disabled','absent'])assert.deepEqual(await checked(clients[label].from('messages').select('body').eq('conversation_id',thread)),[]);
   for(const label of ['owner','pilot','other']){assert.equal((await clients[label].from('messages').insert({conversation_id:thread,sender_id:accounts.owner.id,body:'Spoofed send'}).retry(false)).error?.code,'42501');assert.equal((await clients[label].from('messages').update({body:'Edited'}).eq('id',message).retry(false)).error?.code,'42501');assert.equal((await clients[label].from('messages').delete().eq('id',message).retry(false)).error?.code,'42501');}
   assert.equal((await admin.from('messages').insert({conversation_id:thread,sender_id:accounts.pilot.id,body:'Privileged API send'}).retry(false)).error?.code,'42501');
   await checked(clients.owner.rpc('change_flight_recipient',{p_flight_id:id,p_recipient_id:accounts.pilot.id,p_selected:false}));
   assert.deepEqual(await checked(clients.pilot.from('flights').select('id').eq('id',id)),[]);
   assert.deepEqual(await checked(clients.pilot.from('messages').select('body').eq('conversation_id',thread)),[{body}]);
   await stack.setMembership(accounts.pilot.id,{role:'member',status:'disabled'});
   try{assert.deepEqual(await checked(clients.pilot.from('messages').select('body').eq('conversation_id',thread)),[]);assert.deepEqual(await checked(clients.owner.from('messages').select('body').eq('conversation_id',thread)),[{body}]);}finally{await stack.setMembership(accounts.pilot.id,{role:'member',status:'active'});}
  });
  await checkScenario('conversation_list_safe_previews_private_context_and_participant_empty_states',async()=>{
   const {id,request}=await acceptedConnection({visibility:'PRIVATE',departure_airport:'ZZZZ207',destination_airport:'YYYY207'});
   const thread=await checked(clients.pilot.rpc('get_or_create_flight_conversation',{p_request_id:request.id}));
   const body='list-preview-207 <script>alert("preview")</script> '+ '🛩'.repeat(200);
   await stack.createOwnedMessage({id:randomUUID(),conversation:thread,sender:accounts.pilot.id,body});
   const read=async label=>{const response=await app.request('/messages',{session:sessions[label]});for(const field of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(response.headers.get(field)??'',/no-store/);const html=await response.text();stack.assertNoCredentialLeaks(html);assert.ok(!html.includes('<script>alert("preview")</script>'));return html;};
   for(const label of ['owner','pilot']){const html=await read(label);assert.match(html,/list-preview-207/);assert.match(html,/ZZZZ207/);assert.ok(html.includes('/dashboard/connections/'+request.id));}
   for(const label of ['other','adminNoProfile','noProfile','disabled','absent']){const html=await read(label);assert.ok(!html.includes('list-preview-207'));assert.ok(!html.includes('ZZZZ207'));if(['other','adminNoProfile','noProfile'].includes(label))assert.match(html,/No conversations yet/);}
   await checked(clients.owner.rpc('change_flight_recipient',{p_flight_id:id,p_recipient_id:accounts.pilot.id,p_selected:false}));
   const closed=await read('pilot');assert.match(closed,/list-preview-207/);assert.match(closed,/Conversation closed/);assert.ok(!closed.includes('ZZZZ207'));assert.match(closed,/Flight details are no longer available/);
   await stack.setMembership(accounts.pilot.id,{role:'member',status:'disabled'});try{assert.ok(!(await read('pilot')).includes('list-preview-207'));assert.match(await read('owner'),/list-preview-207/);}finally{await stack.setMembership(accounts.pilot.id,{role:'member',status:'active'});}
   const invalid=await app.request('/messages?after=invalid',{session:sessions.owner});assert.match(await invalid.text(),/This conversation page is unavailable/);
  });
  const messageMode=async value=>assert.equal((await app.request('/api/message-control',{method:'POST',body:value})).status,200);
  const messageCalls=async()=>(await(await app.request('/api/message-control')).json()).calls;
  const history=async(thread,label='pilot',before=null)=>{
   const response=await app.request('/api/message-history?conversation='+thread+(before?'&before='+encodeURIComponent(before):''),{session:sessions[label]});
   for(const field of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(response.headers.get(field)??'',/no-store/);
   const body=await response.text();stack.assertNoCredentialLeaks(body);assert.ok(!body.includes('private-message-error-canary'));return JSON.parse(body);
  };
  const send=async(thread,message,body,label='pilot',settings={})=>{
   const response=await app.sendMessage({conversation_id:thread,message_id:message,body},{session:sessions[label],...settings});
   for(const field of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(response.headers.get(field)??'',/no-store/);
   const text=(await response.text()).replaceAll('&quot;','"');stack.assertNoCredentialLeaks(text);assert.ok(!text.includes('private-message-error-canary'));return {response,body:text};
  };
  await checkScenario('message_actions_native_fetched_exact_retry_unicode_and_derived_sender',async()=>{
   const pair=await acceptedConnection(),thread=await checked(clients.pilot.rpc('get_or_create_flight_conversation',{p_request_id:pair.request.id})),message=randomUUID(),body="message-action-canary pilot's <script>text</script>\nSecond line 🛩";
   expectCode(await send(thread,message,body,'pilot',{transport:'native'}),'sent');
   expectCode(await send(thread,message,body),'sent');
   const stored=await checked(clients.pilot.from('messages').select('id,sender_id,body').eq('conversation_id',thread));assert.deepEqual(stored,[{id:message,sender_id:accounts.pilot.id,body}]);
   expectCode(await send(thread,message,body+' changed'),'invalid_input');
   const maximum='🛩'.repeat(4000),second=randomUUID();const result=await send(thread,second,maximum,'owner');expectCode(result,'sent');assert.ok(!result.body.includes(maximum),'Send confirmation excludes body');
   const read=await history(thread);assert.equal(read.status,'authorized');assert.equal(read.sendStatus,'available');assert.deepEqual(read.messages.map(m=>m.id),[message,second]);assert.equal(read.messages[1].senderId,accounts.owner.id);assert.equal(read.messages[1].body,maximum);assert.equal(read.olderCursor,null);
   const actionHtml=await(await app.request('/dashboard/message-fixture',{session:sessions.pilot})).text();
   for(const body of ['', ' \n\t','x'.repeat(4001)])expectCode(await send(thread,randomUUID(),body,'pilot',{formHtml:actionHtml}),'invalid_input');
   const beforeCalls=await messageCalls();for(const key of ['sender_id','owner_id','created_at']){const response=await app.sendMessage({conversation_id:thread,message_id:randomUUID(),body:'forged',[key]:accounts.owner.id},{session:sessions.pilot,formHtml:actionHtml});expectCode({body:(await response.text()).replaceAll('&quot;','"')},'invalid_input');}assert.equal(await messageCalls(),beforeCalls);
  });
  await checkScenario('message_actions_deny_foreign_closed_and_bad_origin_and_preserve_uncertain_retry_identity',async()=>{
   const pair=await acceptedConnection({visibility:'PRIVATE'}),thread=await checked(clients.pilot.rpc('get_or_create_flight_conversation',{p_request_id:pair.request.id}));
   const before=await messageCalls();for(const label of ['other','adminNoProfile','noProfile'])expectCode(await send(thread,randomUUID(),'Denied',label),'conversation_unavailable');
   for(const label of ['disabled','absent'])expectCode(await send(thread,randomUUID(),'Denied',label),'forbidden');
   const rejected=await send(thread,randomUUID(),'Bad origin','pilot',{origin:'https://untrusted.invalid'});assert.ok(!rejected.body.includes('"code":"sent"'));assert.equal(await messageCalls(),before);
   for(const mode of ['lost','malformed']){
    const message=randomUUID(),body='uncertain-message-'+mode,prior=await messageCalls();await messageMode(mode);
    try{expectCode(await send(thread,message,body),'send_unconfirmed');assert.equal(await messageCalls(),prior+1);}finally{await messageMode('off');}
    expectCode(await send(thread,message,body),'sent');const stored=await checked(clients.pilot.from('messages').select('id').eq('id',message));assert.equal(stored.length,1);
   }
   await checked(clients.owner.rpc('change_flight_recipient',{p_flight_id:pair.id,p_recipient_id:accounts.pilot.id,p_selected:false}));
   const closed=await history(thread);assert.equal(closed.status,'authorized');assert.equal(closed.sendStatus,'closed');assert.equal(closed.messages.length,2);assert.ok(!JSON.stringify(closed).includes(pair.id));
   const calls=await messageCalls();expectCode(await send(thread,randomUUID(),'Closed'),'conversation_unavailable');assert.equal(await messageCalls(),calls);
   for(const label of ['other','adminNoProfile','noProfile'])assert.deepEqual(await history(thread,label),{status:'missing'});
  });
  await checkScenario('message_history_pages_fail_closed_on_outage_and_mid_read_revocation',async()=>{
   const pair=await acceptedConnection(),thread=await checked(clients.pilot.rpc('get_or_create_flight_conversation',{p_request_id:pair.request.id}));
   const ids=Array.from({length:34},()=>randomUUID());for(const id of ids)await checked(clients.pilot.rpc('send_conversation_message',{p_conversation_id:thread,p_message_id:id,p_body:'Owned paged message '+id}));
   const first=await history(thread);assert.equal(first.status,'authorized');assert.equal(first.messages.length,30);assert.deepEqual(first.messages.map(m=>m.id),ids.slice(4));assert.ok(first.olderCursor);
   const second=await history(thread,'pilot',first.olderCursor);assert.equal(second.status,'authorized');assert.deepEqual(second.messages.map(m=>m.id),ids.slice(0,4));assert.equal(second.olderCursor,null);
   assert.deepEqual(await history(thread,'pilot','invalid'),{status:'invalid'});
   await messageMode('read-outage');try{assert.deepEqual(await history(thread),{status:'unavailable'});}finally{await messageMode('off');}
   await stack.setMembership(accounts.owner.id,{role:'member',status:'disabled'});try{const retained=await history(thread);assert.equal(retained.status,'authorized');assert.equal(retained.sendStatus,'closed');expectCode(await send(thread,randomUUID(),'Inactive counterpart'),'forbidden');}finally{await stack.setMembership(accounts.owner.id,{role:'member',status:'active'});}
   await messageMode('disable-history:'+accounts.pilot.id);try{const denied=await history(thread);assert.notEqual(denied.status,'authorized');assert.equal(denied.messages,undefined);}finally{await messageMode('off');await stack.setMembership(accounts.pilot.id,{role:'member',status:'active'});}
   assert.equal((await history(thread)).status,'authorized');
   const invisible=randomUUID();await checked(clients.pilot.rpc('send_conversation_message',{p_conversation_id:thread,p_message_id:invisible,p_body:'\uFEFF'}));
   const retained=await history(thread);assert.equal(retained.status,'authorized');assert.equal(retained.messages.at(-1).body,'\uFEFF');
   const list=await app.request('/messages',{session:sessions.pilot});assert.match(await list.text(),/No preview available/);
  });
  await checkScenario('message_guarded_rpc_and_realtime_enforce_current_participants_without_delete_events',async()=>{
   const pair=await acceptedConnection({visibility:'PRIVATE'}),thread=await checked(clients.owner.rpc('get_or_create_flight_conversation',{p_request_id:pair.request.id}));
   const labels=['owner','pilot','other','disabled','absent'],events=Object.fromEntries(labels.map(label=>[label,[]])),channels=[];
   const send=(label,id,body='Owned realtime message')=>clients[label].rpc('send_conversation_message',{p_conversation_id:thread,p_message_id:id,p_body:body}).retry(false);
   const delivered=async(count,pilotCount=count)=>{const end=Date.now()+10000;while(Date.now()<end){if(events.owner.length>=count&&events.pilot.length>=pilotCount)return;await delay(100);}assert.fail('Expected participant Realtime delivery not observed: '+events.owner.length+'/'+events.pilot.length+' expected '+count+'/'+pilotCount);};
   try{
    await Promise.all(labels.map(async label=>{
     const refreshed=await clients[label].auth.refreshSession();assert.equal(refreshed.error,null);await clients[label].realtime.setAuth(refreshed.data.session.access_token);
     const channel=clients[label].channel('owned-message-'+randomUUID(),{config:{postgres_changes_options:{wait:true,timeout:15000}}}).on('postgres_changes',{event:'*',schema:'public',table:'messages'},payload=>events[label].push(payload));channels.push([label,channel]);
     await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Owned Realtime subscription timed out')),20000);channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){clearTimeout(timer);if(label==='owner'||label==='pilot')reject(Error('Participant Realtime subscription denied'));else resolve();}});});
    }));
    const id=randomUUID(),first=await send('pilot',id);assert.equal(first.error,null);assert.deepEqual(Object.keys(first.data).sort(),['conversationId','createdAt','id','senderId']);assert.equal(first.data.id,id);assert.equal(first.data.senderId,accounts.pilot.id);
    await delivered(1);assert.equal(events.owner[0].new.body,'Owned realtime message');assert.equal(events.pilot[0].new.sender_id,accounts.pilot.id);
    const repeated=await send('pilot',id);assert.equal(repeated.error,null);assert.deepEqual(repeated.data,first.data);assert.equal((await send('pilot',id,'Do not overwrite')).error?.code,'22023');
    for(const label of ['other','disabled','absent'])assert.equal((await send(label,randomUUID())).error?.code,'42501');
    assert.equal((await clients.pilot.rpc('send_conversation_message',{p_conversation_id:thread,p_message_id:randomUUID(),p_body:'Forged',p_sender_id:accounts.owner.id}).retry(false)).error?.code,'PGRST202');
    assert.equal((await admin.rpc('send_conversation_message',{p_conversation_id:thread,p_message_id:randomUUID(),p_body:'Service bypass'}).retry(false)).error?.code,'42501');
    const probe=randomUUID();await stack.createOwnedMessage({id:probe,conversation:thread,sender:accounts.owner.id,body:'Owned retained-token delivery probe',disableAfterInsert:accounts.pilot.id});
    try{await delivered(2,1);await delay(300);assert.equal(events.pilot.length,1,'Disabled subscribed participant cannot receive committed probe');assert.equal((await send('pilot',randomUUID())).error?.code,'42501');assert.equal((await send('owner',randomUUID())).error?.code,'42501');assert.deepEqual(await checked(clients.pilot.from('messages').select('id').eq('conversation_id',thread)),[]);}finally{await stack.setMembership(accounts.pilot.id,{role:'member',status:'active'});}
    await checked(clients.pilot.rpc('withdraw_flight_request',{p_flight_id:pair.id,p_request_id:pair.request.id}));assert.equal((await send('owner',randomUUID())).error?.code,'42501');
    await checked(clients.owner.rpc('change_flight_recipient',{p_flight_id:pair.id,p_recipient_id:accounts.pilot.id,p_selected:false}));assert.deepEqual(await checked(clients.pilot.from('flights').select('id').eq('id',pair.id)),[]);assert.deepEqual(await checked(clients.pilot.from('messages').select('id').eq('conversation_id',thread).order('id')),[{id},{id:probe}].sort((a,b)=>a.id.localeCompare(b.id)));
    // Delete only owned local history, then use another authorized insert as a
    // delivery fence: wildcard subscribers must never receive DELETE payloads.
    await stack.removeOwnedConversations(accounts.owner.id);
    const control=await acceptedConnection(),controlThread=await checked(clients.owner.rpc('get_or_create_flight_conversation',{p_request_id:control.request.id}));
    await checked(clients.owner.rpc('send_conversation_message',{p_conversation_id:controlThread,p_message_id:randomUUID(),p_body:'Owned delivery fence'}));await delivered(3,2);
    await delay(300);
    for(const label of ['owner','pilot']){assert.equal(events[label].length,label==='owner'?3:2);assert.ok(events[label].every(event=>event.eventType==='INSERT'));}
    for(const label of ['other','disabled','absent'])assert.deepEqual(events[label],[],'Unauthorized wildcard subscriber receives no private rows');
    stack.assertNoCredentialLeaks(JSON.stringify(events));
   }finally{await Promise.allSettled(channels.map(([label,channel])=>clients[label].removeChannel(channel)));for(const label of labels)clients[label].realtime.disconnect();}
  });
  const cancellationMode=async value=>assert.equal((await app.request('/api/cancellation-control',{method:'POST',body:value})).status,200);
  const cancellationCalls=async()=>(await(await app.request('/api/cancellation-control')).json()).calls;
  const cancel=async(id,fields={},settings={})=>{
   const response=await app.cancellationPageAction(id,fields,{session:sessions.owner,transport:'native',...settings});
   for(const name of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(response.headers.get(name)??'',/no-store/);
   const body=(await response.text()).replaceAll('&quot;','"');stack.assertNoCredentialLeaks(body);for(const s of Object.values(sessions))s.assertNoCredentialLeaks(body);assert.ok(!body.includes('private-cancellation-error-canary'));return body;
  };
  await checkScenario('cancellation_native_and_fetched_refresh_owner_requester_and_feed',async()=>{
   for(const transport of ['native','fetched']){
    const id=await newFlight({visibility:transport==='native'?'PRIVATE':'NETWORK',pilot_places:2,notes:'Retained cancellation flight notes'});
    if(transport==='native')await checked(admin.from('flight_recipients').insert([accounts.pilot,accounts.other].map(a=>({flight_id:id,user_id:a.id}))));
    expectCode(await invoke('pilot',id,{introductory_note:'Retained accepted introduction'}),'submitted');expectCode(await invoke('other',id,{introductory_note:'Retained pending introduction'}),'submitted');
    await checked(admin.from('flight_requests').update({status:'accepted'}).eq('flight_id',id).eq('requester_id',accounts.pilot.id));
    const before=(await rows()).filter(r=>r.flight_id===id),initial=await page(id,'owner');
    assert.match(initial.body,/Confirm flight cancellation/);assert.match(initial.body,/<input[^>]*required[^>]*name="confirmation"|<input[^>]*name="confirmation"[^>]*required/);
    assert.ok(!(await page(id)).body.includes('Confirm flight cancellation'),'Requester has no owner control');
    assert.match(await cancel(id,{}, {transport,formHtml:initial.html}),/Flight cancelled\. Pending and accepted requests are closed/);
    const closed=(await rows()).filter(r=>r.flight_id===id);assert.equal(closed.length,2);assert.ok(closed.every(r=>r.status==='cancelled'));
    for(const row of closed)for(const field of ['id','flight_id','requester_id','introductory_note','created_at'])assert.equal(row[field],before.find(r=>r.id===row.id)[field]);
    const owner=(await page(id,'owner')).body,pilot=(await page(id)).body;
    for(const body of [owner,pilot]){assert.match(body,/Cancelled flight/);assert.match(body,/Retained cancellation flight notes/);assert.ok(!body.includes('>Edit flight<'));}
    assert.match(owner,/Retained accepted introduction/);assert.match(owner,/Retained pending introduction/);assert.ok(!owner.includes('Confirm cancellation'));assert.ok(!/value="accepted"|value="declined"/.test(owner));
    assert.match(pilot,/closed and cannot be submitted again/);assert.ok(!pilot.includes('Withdraw request'));assert.ok(!hasForm(pilot));
    const feed=await app.request('/dashboard/flights',{session:sessions.owner});assert.ok(!(await feed.text()).includes('href="/dashboard/flights/'+id+'"'));
   }
  });
  await checkScenario('cancellation_rejects_unconfirmed_forged_and_revoked_forms',async()=>{
   const id=await newFlight(),cached=(await page(id,'owner')).html;
   const snapshot=()=>checked(admin.from('flights').select('*').eq('id',id).single());const before=await snapshot();
   for(const fields of [{confirmation:undefined},{confirmation:'on'},{owner_id:accounts.owner.id},{role:'admin'},{status:'cancelled'},{intent:'withdraw'},{confirmation:'x'.repeat(3000)}]){
    const count=await cancellationCalls();assert.match(await cancel(id,fields,{formHtml:cached}),/Check flight status/);assert.equal(await cancellationCalls(),count,'Invalid form never calls cancellation RPC');assert.deepEqual(await snapshot(),before);
   }
   for(const label of [null,'disabled','absent','pilot','noProfile']){
    const body=await cancel(id,{}, {formHtml:cached,session:sessions[label]});assert.ok(!body.includes('Flight cancelled.'));assert.deepEqual(await snapshot(),before);
   }
   const count=await cancellationCalls();await cancel(id,{}, {formHtml:cached,origin:null});assert.equal(await cancellationCalls(),count);assert.deepEqual(await snapshot(),before);
   await stack.setMembership(accounts.owner.id,{role:'member',status:'disabled'});
   try{await cancel(id,{}, {formHtml:cached});assert.equal(await cancellationCalls(),count);assert.deepEqual(await snapshot(),before);}finally{await stack.setMembership(accounts.owner.id,{role:'member',status:'active'});}
   const noProfile=await newFlight({owner_id:accounts.noProfile.id});assert.match(await cancel(noProfile,{}, {formHtml:(await page(noProfile,'noProfile')).html,session:sessions.noProfile}),/Flight cancelled\./);
   const adminId=await newFlight();assert.match(await cancel(adminId,{}, {formHtml:cached,session:sessions.adminNoProfile}),/Flight cancelled\./,'Authoritative admin RPC authorization remains available without exposing owner controls');
  });
  await checkScenario('cancellation_stale_forms_confirm_idempotently_or_report_completed_conflict',async()=>{
   const id=await newFlight(),cached=(await page(id,'owner')).html;
   assert.match(await cancel(id,{}, {formHtml:cached}),/Flight cancelled\./);const before=await checked(admin.from('flights').select('*').eq('id',id).single());
   assert.match(await cancel(id,{}, {formHtml:cached,transport:'fetched'}),/Flight cancelled\./);assert.deepEqual(await checked(admin.from('flights').select('*').eq('id',id).single()),before);
   const completed=await newFlight(),formHtml=(await page(completed,'owner')).html;await checked(admin.from('flights').update({status:'completed'}).eq('id',completed));
   const body=await cancel(completed,{}, {formHtml});assert.match(body,/Check flight status/);assert.match(body,/<fieldset[^>]*disabled/);assert.ok(!body.includes('Flight cancelled.'));
   assert.match((await page(completed,'owner')).body,/Completed flight/);assert.ok(!(await page(completed,'owner')).body.includes('Confirm cancellation'));
  });
  await checkScenario('cancellation_lost_and_malformed_confirmations_require_explicit_reload',async()=>{
   for(const mode of ['lost','malformed']){
    const id=await newFlight(),count=await cancellationCalls();await cancellationMode(mode);let body;
    try{body=await cancel(id,{}, {transport:mode==='lost'?'native':'fetched'});}finally{await cancellationMode('off');}
    assert.match(body,/Unable to confirm cancellation/);assert.match(body,/Check flight status/);
    // Native responses render HTML; fetched responses deliver the client form state.
    if(mode==='lost')assert.match(body,/<fieldset[^>]*disabled/);else assert.match(body,/"status":"unconfirmed"/);
    assert.ok(!body.includes('Flight cancelled.'));
    assert.equal(await cancellationCalls(),count+1,'Unknown confirmation never causes automatic retry');
    const current=(await page(id,'owner')).body;assert.match(current,/Cancelled flight/);assert.ok(!current.includes('Confirm cancellation'));
   }
  });
  const editMode=async value=>assert.equal((await app.request('/api/edit-control',{method:'POST',body:value})).status,200);
  const editCalls=async()=>(await(await app.request('/api/edit-control')).json()).calls;
  const editPage=async(id,label='owner')=>{const response=await app.request('/dashboard/flights/'+id+'/edit',{session:sessions[label]});return {response,html:await response.text()};};
  const edit=async(id,fields={},settings={})=>{
   const response=await app.editPageAction(id,fields,{session:sessions.owner,transport:'native',...settings});for(const name of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(response.headers.get(name)??'',/no-store/);
   const body=(await response.text()).replaceAll('&quot;','"');stack.assertNoCredentialLeaks(body);for(const s of Object.values(sessions))s.assertNoCredentialLeaks(body);assert.ok(!body.includes('private-edit-error-canary'));return body;
  };
  await checkScenario('edit_owner_native_and_fetched_preserve_precision_audience_and_participants',async()=>{
   const id=await newFlight({visibility:'PRIVATE',pilot_places:2,notes:'Initial owner note'});await checked(admin.from('flight_recipients').insert({flight_id:id,user_id:accounts.pilot.id}));expectCode(await invoke('pilot',id),'submitted');
   const initial=(await checked(admin.from('flights').select('*').eq('id',id)))[0],cached=(await editPage(id)).html;assert.match(cached,/Initial owner note/);assert.match(cached,/expected_updated_at/);assert.ok(!cached.includes('name="visibility"'));assert.ok(!cached.includes('name="recipient_ids"'));
   assert.match(await edit(id,{departure_airport:'KSFO',notes:'Native owner edit'},{formHtml:cached}),/Flight updated/);const first=(await checked(admin.from('flights').select('*').eq('id',id)))[0];assert.equal(first.departure_at,initial.departure_at);assert.equal(first.visibility,'PRIVATE');assert.equal(first.departure_airport,'KSFO');
   assert.match(await edit(id,{departure_airport:'KSFO',notes:'Native owner edit'},{formHtml:cached}),/Flight updated/);assert.deepEqual((await checked(admin.from('flights').select('*').eq('id',id)))[0],first);
   await checked(admin.from('flight_requests').update({status:'accepted'}).eq('flight_id',id));const locked=(await editPage(id)).html;assert.match(locked,/Cancel and repost/);assert.match(locked,/<input(?=[^>]*name="aircraft_description")(?=[^>]*readOnly)[^>]*>/i);
   assert.match(await edit(id,{notes:'Fetched briefing update'},{transport:'fetched'}),/Flight updated/);const stored=(await checked(admin.from('flights').select('*').eq('id',id)))[0];assert.equal(stored.departure_at,initial.departure_at);assert.equal(stored.notes,'Fetched briefing update');assert.equal((await rows()).find(r=>r.flight_id===id).status,'accepted');
   assert.match((await page(id,'pilot')).body,/Fetched briefing update/);assert.equal((await checked(admin.from('flight_recipients').select('user_id').eq('flight_id',id))).length,1);
  });
  await checkScenario('edit_owner_access_origin_and_protected_fields_fail_without_mutation',async()=>{
   const id=await newFlight(),html=(await editPage(id)).html,before=(await checked(admin.from('flights').select('*').eq('id',id)))[0],calls=await editCalls();
   for(const label of ['pilot','other','disabled','absent',null]){const result=await app.request('/dashboard/flights/'+id+'/edit',{session:label?sessions[label]:undefined});assert.ok(!(await result.text()).includes('name="expected_updated_at"'));await edit(id,{notes:'Foreign attempt'},{formHtml:html,session:label?sessions[label]:undefined});}
   for(const fields of [{owner_id:accounts.owner.id},{visibility:'NETWORK'},{status:'cancelled'},{recipient_ids:'[]'},{departure_timezone:'bad'}])assert.match(await edit(id,fields,{formHtml:html}),/Check the highlighted|Reload|could not be verified/);
   await edit(id,{notes:'Wrong origin'},{formHtml:html,origin:null});assert.deepEqual((await checked(admin.from('flights').select('*').eq('id',id)))[0],before);assert.equal(await editCalls(),calls);
   await editMode('disable:'+accounts.owner.id);try{assert.match(await edit(id,{notes:'Revoked owner'},{formHtml:html}),/could not be verified|Access denied/);assert.deepEqual((await checked(admin.from('flights').select('*').eq('id',id)))[0],before);}finally{await editMode('off');await stack.setMembership(accounts.owner.id,{role:'member',status:'active'});}
   const closed=await newFlight({status:'cancelled'});assert.ok(!(await editPage(closed)).html.includes('name="expected_updated_at"'));
  });
  await checkScenario('edit_stale_material_and_capacity_changes_require_reload_without_overwrite',async()=>{
   const id=await newFlight({pilot_places:2}),html=(await editPage(id)).html;assert.match(await edit(id,{notes:'Winning note'},{formHtml:html}),/Flight updated/);const winner=(await checked(admin.from('flights').select('*').eq('id',id)))[0];assert.match(await edit(id,{notes:'Stale loser'},{formHtml:html}),/changed after you opened/);assert.deepEqual((await checked(admin.from('flights').select('*').eq('id',id)))[0],winner);
   expectCode(await invoke('pilot',id),'submitted');const record=(await rows()).find(r=>r.flight_id===id),fresh=(await editPage(id)).html;await editMode('accept:'+record.id);try{assert.match(await edit(id,{aircraft_description:'Unauthorized changed aircraft'},{formHtml:fresh}),/Cancel and repost/);}finally{await editMode('off');}
   expectCode(await invoke('other',id),'submitted');const other=(await rows()).find(r=>r.flight_id===id&&r.requester_id===accounts.other.id),capacity=(await editPage(id)).html;await editMode('accept:'+other.id);try{assert.match(await edit(id,{pilot_places:'1'},{formHtml:capacity}),/Accepted participants changed/);}finally{await editMode('off');}
   const stored=(await checked(admin.from('flights').select('*').eq('id',id)))[0];assert.equal(stored.aircraft_description,'Owned interest C172');assert.equal(stored.pilot_places,2);
  });
  await checkScenario('edit_uncertain_confirmation_blocks_repeat_and_native_reload_recovers',async()=>{
   for(const failure of ['lost','malformed']){const id=await newFlight(),calls=await editCalls();await editMode(failure);try{const body=await edit(id,{notes:'Committed despite uncertain reply'});assert.match(body,/Unable to confirm your edit/);assert.match(body,/<fieldset[^>]*disabled/);assert.match(body,/Reload current flight/);}finally{await editMode('off');}assert.equal(await editCalls(),calls+1);assert.match((await editPage(id)).html,/Committed despite uncertain reply/);}
  });
  const withdrawalMode=async value=>assert.equal((await app.request('/api/withdrawal-control',{method:'POST',body:value})).status,200);
  const withdrawalCalls=async()=>(await(await app.request('/api/withdrawal-control')).json()).calls;
  const withdraw=async(id,settings={})=>{
   const response=await app.interestPageAction(id,{intent:'withdraw',...settings.fields},{session:sessions.pilot,transport:'native',...settings});
   for(const field of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(response.headers.get(field)??'',/no-store/);
   const body=(await response.text()).replaceAll('&quot;','"');stack.assertNoCredentialLeaks(body);for(const session of Object.values(sessions))session.assertNoCredentialLeaks(body);
   assert.ok(!body.includes('private-withdrawal-error-canary'));return body;
  };
  await checkScenario('withdrawal_pending_native_and_accepted_fetched_allow_same_record_resubmission',async()=>{
   for(const [status,transport] of [['pending','native'],['accepted','fetched']]){
    const id=await newFlight();expectCode(await invoke('pilot',id,{introductory_note:'Retain withdrawal history'}),'submitted');const record=(await rows()).find(r=>r.flight_id===id);
    if(status==='accepted')await checked(clients.owner.rpc('decide_flight_request',{p_flight_id:id,p_request_id:record.id,p_decision:'accepted'}));
    const before=(await page(id)).body;assert.match(before,/>Withdraw request</);assert.ok(!hasForm(before));assert.ok(!(await page(id,'owner')).body.includes('>Withdraw request<'));assert.ok(!(await page(id,'other')).body.includes('>Withdraw request<'));
    const result=await withdraw(id,{transport});assert.match(result,/Request withdrawn/);
    if(transport==='native'){assert.ok(hasForm(result),'Native withdrawal renders resubmission form');assert.match(result,/Submit interest again/);assert.ok(!result.includes('>Withdraw request<'));}
    else {assert.match(result,/"status":"withdrawn"/);assert.match(result,/"mode":"resubmit"/);}
    assert.ok(hasForm((await page(id)).body),'Confirmed withdrawal permits resubmission in the current requester view');
    const stored=(await rows()).find(r=>r.id===record.id);assert.equal(stored.status,'withdrawn');assert.equal(stored.introductory_note,record.introductory_note);assert.equal(stored.created_at,record.created_at);
    assert.match((await page(id,'owner')).body,/Withdrawn/);
    assert.match(await pageAction(id,{introductory_note:'Fresh request for approval'}),/Request pending/);assert.equal((await rows()).find(r=>r.flight_id===id).id,record.id);assert.equal((await rows()).find(r=>r.id===record.id).status,'pending');
   }
  });
  await checkScenario('withdrawal_forged_input_access_and_revocation_never_mutate_foreign_requests',async()=>{
   const id=await newFlight();expectCode(await invoke('pilot',id),'submitted');const html=(await page(id)).html,before=await rows(),beforeCalls=await withdrawalCalls();
   for(const label of ['owner','other','disabled','absent',null])await withdraw(id,{formHtml:html,session:label?sessions[label]:undefined});
   for(const fields of [{requester_id:accounts.pilot.id},{request_id:before.find(r=>r.flight_id===id).id},{owner_id:accounts.owner.id},{status:'withdrawn'},{introductory_note:'cannot rewrite'}])assert.match(await withdraw(id,{formHtml:html,fields}),/has changed/);
   await withdraw(id,{formHtml:html,origin:null});assert.deepEqual(await rows(),before);assert.equal(await withdrawalCalls(),beforeCalls,'Denied actions never invoke withdrawal RPC');
   await withdrawalMode('disable:'+accounts.pilot.id);
   try{const result=await withdraw(id,{formHtml:html});assert.match(result,/access could not be verified|Access denied/);assert.equal((await rows()).find(r=>r.flight_id===id).status,'pending');}
   finally{await withdrawalMode('off');await stack.setMembership(accounts.pilot.id,{role:'member',status:'active'});}
   const profile=(await checked(admin.from('profiles').select('*').eq('user_id',accounts.pilot.id)))[0];await stack.removeOwnedProfile(accounts.pilot.id);
   try{assert.match((await page(id)).body,/>Withdraw request</);assert.match(await withdraw(id),/Request withdrawn/);assert.ok(!hasForm((await page(id)).body));}
   finally{await checked(admin.from('profiles').insert(profile));}
  });
  await checkScenario('withdrawal_terminal_stale_and_matching_retries_preserve_history',async()=>{
   for(const status of ['declined','cancelled','withdrawn']){
    const id=await newFlight();expectCode(await invoke('pilot',id),'submitted');const html=(await page(id)).html;await checked(admin.from('flight_requests').update({status}).eq('flight_id',id));const snapshot=(await rows()).find(r=>r.flight_id===id);
    assert.match(await withdraw(id,{formHtml:html}),status==='withdrawn'?/Request withdrawn/:/request has changed/);assert.deepEqual((await rows()).find(r=>r.id===snapshot.id),snapshot);assert.ok(!(await page(id)).body.includes('>Withdraw request<'));
   }
  });
  await checkScenario('withdrawal_lost_and_malformed_confirmation_require_native_status_reload',async()=>{
   for(const failure of ['lost','malformed']){
    const id=await newFlight();expectCode(await invoke('pilot',id),'submitted');const before=await withdrawalCalls();await withdrawalMode(failure);
    try{const body=await withdraw(id);assert.match(body,/Unable to confirm your withdrawal/);assert.ok(!body.includes('>Withdraw request<'));assert.ok(!hasForm(body));assert.match(body,new RegExp('<form[^>]*action="/dashboard/flights/'+id+'"[^>]*method="get"[^>]*><button[^>]*>Check request status</button></form>'));}
    finally{await withdrawalMode('off');}
    assert.equal(await withdrawalCalls(),before+1,'Uncertain withdrawal never retries');assert.equal((await rows()).find(r=>r.flight_id===id).status,'withdrawn');assert.match((await page(id)).body,/Submit interest again/);
   }
  });
  const decisionMode=async value=>assert.equal((await app.request('/api/decision-control',{method:'POST',body:value})).status,200);
  const decisionCalls=async()=>(await(await app.request('/api/decision-control')).json()).calls;
  const decide=async(id,requestId,decision='accepted',settings={})=>{
   const response=await app.decisionPageAction(id,requestId,{decision,...settings.fields},{session:sessions.owner,transport:'native',...settings});
   for(const field of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(response.headers.get(field)??'',/no-store/);
   const body=(await response.text()).replaceAll('&quot;','"');stack.assertNoCredentialLeaks(body);for(const session of Object.values(sessions))session.assertNoCredentialLeaks(body);
   assert.ok(!body.includes('private-decision-error-canary'));return body;
  };
  await checkScenario('decision_owner_native_accept_and_fetched_decline_update_both_views',async()=>{
   for(const [decision,transport] of [['accepted','native'],['declined','fetched']]){
    const id=await newFlight();expectCode(await invoke('pilot',id,{introductory_note:'Decision intro'}),'submitted');const record=(await rows()).find(r=>r.flight_id===id);
    const before=(await page(id,'owner')).body;assert.match(before,/<button(?=[^>]*name="decision")(?=[^>]*value="accepted")[^>]*>Accept/);assert.match(before,/<button(?=[^>]*name="decision")(?=[^>]*value="declined")[^>]*>Decline/);
    const result=await decide(id,record.id,decision,{transport});assert.ok(result.includes(decision==='accepted'?'Request accepted.':'Request declined.'));
    const stored=(await rows()).find(r=>r.id===record.id);assert.equal(stored.status,decision);assert.equal(stored.introductory_note,'Decision intro');
    const owner=(await page(id,'owner')).body;assert.ok(!owner.includes('name="decision"'));assert.ok(owner.includes(decision==='accepted'?'Accepted':'Declined'));
    const pilot=(await page(id)).body;assert.ok(pilot.includes(decision==='accepted'?'Your request has been accepted':'closed and cannot be submitted again'));
   }
  });
  await checkScenario('decision_forged_owner_actions_and_input_fail_without_mutation',async()=>{
   const id=await newFlight();expectCode(await invoke('pilot',id),'submitted');const record=(await rows()).find(r=>r.flight_id===id),html=(await page(id,'owner')).html,before=await rows(),callsBefore=await decisionCalls();
   for(const label of ['pilot','other','disabled','absent',null]){const body=await decide(id,record.id,'accepted',{session:label?sessions[label]:undefined,formHtml:html});assert.ok(!body.includes('Request accepted.'));}
   for(const fields of [{owner_id:accounts.owner.id},{requester_id:accounts.pilot.id},{status:'accepted'},{decision:'cancelled'}])assert.match(await decide(id,record.id,'accepted',{formHtml:html,fields}),/Check request status|has changed/);
   await decide(id,record.id,'accepted',{formHtml:html,origin:null});
   assert.deepEqual(await rows(),before);assert.equal(await decisionCalls(),callsBefore,'Rejected owner/input/origin never reaches decision RPC');
   const foreign=await newFlight();expectCode(await invoke('pilot',foreign,{introductory_note:'foreign-decision-note-canary'}),'submitted');const foreignRequest=(await rows()).find(r=>r.flight_id===foreign);
   const mismatch=await decide(id,foreignRequest.id,'accepted',{fromRequestId:record.id,formHtml:html});assert.match(mismatch,/has changed/);assert.ok(!mismatch.includes('foreign-decision-note-canary'));assert.equal((await rows()).find(r=>r.id===foreignRequest.id).status,'pending');
   await decisionMode('disable:'+accounts.owner.id);
   try{assert.match(await decide(id,record.id,'accepted',{formHtml:html}),/owner access could not be verified|Access denied/);assert.equal((await rows()).find(r=>r.id===record.id).status,'pending');}
   finally{await decisionMode('off');await stack.setMembership(accounts.owner.id,{role:'member',status:'active'});}
  });
  await checkScenario('decision_stale_capacity_and_opposing_forms_preserve_current_state',async()=>{
   const id=await newFlight();expectCode(await invoke('pilot',id),'submitted');expectCode(await invoke('other',id),'submitted');
   const records=(await rows()).filter(r=>r.flight_id===id),first=records.find(r=>r.requester_id===accounts.pilot.id),second=records.find(r=>r.requester_id===accounts.other.id),html=(await page(id,'owner')).html;
   assert.match(await decide(id,first.id,'accepted',{formHtml:html}),/Request accepted/);
   const full=await decide(id,second.id,'accepted',{formHtml:html});assert.match(full,/This flight is full/);assert.match(full,/request is still pending/);assert.equal((await rows()).find(r=>r.id===second.id).status,'pending');
   const accepted=(await rows()).find(r=>r.id===first.id);assert.match(await decide(id,first.id,'declined',{formHtml:html}),/has changed/);assert.deepEqual((await rows()).find(r=>r.id===first.id),accepted);
   assert.match(await decide(id,second.id,'declined',{formHtml:html}),/Request declined/);assert.equal((await rows()).find(r=>r.id===second.id).status,'declined');
  });
  await checkScenario('decision_lost_or_malformed_confirmation_blocks_repeat_and_reload_recovers',async()=>{
   for(const failure of ['lost','malformed']){
    const id=await newFlight();expectCode(await invoke('pilot',id),'submitted');const record=(await rows()).find(r=>r.flight_id===id),before=await decisionCalls();await decisionMode(failure);
    try{const body=await decide(id,record.id);assert.match(body,/Unable to confirm your decision/);assert.match(body,new RegExp('<form[^>]*action="/dashboard/flights/'+id+'#request-'+record.id+'"[^>]*method="get"[^>]*><button[^>]*type="submit"[^>]*>Check request status</button></form>'));}
    finally{await decisionMode('off');}
    assert.equal(await decisionCalls(),before+1,'Unknown confirmation never automatically retries');assert.equal((await rows()).find(r=>r.id===record.id).status,'accepted');
    const reloaded=(await page(id,'owner')).body;assert.match(reloaded,/Accepted/);assert.ok(!reloaded.includes('name="decision"'));
   }
  });
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
  await app.request('/api/connection-control',{method:'POST',body:'off'});
  await app.request('/api/cancellation-control',{method:'POST',body:'off'});
  await app.request('/api/edit-control',{method:'POST',body:'off'});
  await app.request('/api/withdrawal-control',{method:'POST',body:'off'});
  await app.request('/api/decision-control',{method:'POST',body:'off'});
  await mode('off');
  if(flights.length){
   for(const account of Object.values(accounts))await stack.removeOwnedConversations(account.id);
   await checked(admin.from('flight_requests').delete().in('flight_id',flights));
   await checked(admin.from('flight_recipients').delete().in('flight_id',flights));
   await checked(admin.from('flights').delete().in('id',flights));
  }
  for(const account of Object.values(accounts))await stack.removeOwnedProfile(account.id);
  for(const client of Object.values(clients))await client.auth.stopAutoRefresh();
 }
}
