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
