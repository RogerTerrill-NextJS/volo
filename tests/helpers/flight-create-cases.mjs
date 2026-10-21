import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {signInSession} from './real-auth-session.mjs';
import {validateLocalApiUrl} from './local-auth-stack.mjs';
import {verifyRecipientSelection} from './recipient-cases.mjs';
import {verifyUpcomingFlightFeed} from './flight-feed-cases.mjs';

export async function verifyFlightCreation({stack,app,scenario}){
  validateLocalApiUrl(stack.apiUrl,Number(new URL(stack.apiUrl).port));
  const localFetch=(input,init)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);assert.equal(url.origin,stack.apiUrl);return fetch(input,{...init,redirect:'error',signal:init?.signal??AbortSignal.timeout(10000)});};
  const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:localFetch}};
  const admin=createClient(stack.apiUrl,stack.serverSecret,options),accounts={},sessions={},clients={};
  const checked=async query=>{const result=await query.retry(false);assert.equal(result.error,null,'Owned creation fixture database operation');return result.data;};
  const rows=()=>checked(admin.from('flights').select('id,owner_id,status,visibility,notes,departure_at').in('owner_id',Object.values(accounts).map(a=>a.id)).order('id'));
  const calls=async()=>{const r=await app.request('/api/flight-create-control');assert.equal(r.status,200);return (await r.json()).calls;};
  const mode=async value=>{assert.equal((await app.request('/api/flight-create-control',{method:'POST',body:value})).status,200);};
  const date=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
  const fields={departure_airport:' kpao ',destination_airport:'KPAO',departure_local_date:date,departure_local_time:'12:00',departure_timezone:'UTC',aircraft_description:' Owned C172 ',pilot_places:'2',visibility:'NETWORK'};
  async function invoke(label,overrides={},settings={}){
    const response=await app.createFlight({...fields,...overrides},{session:sessions[label],...settings});
    for(const header of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(response.headers.get(header)??'',/no-store/,`Creation response stays private (${label??'anonymous'}, ${header}, HTTP ${response.status})`);
    const text=(await response.text()).replaceAll('&quot;','"');stack.assertNoCredentialLeaks(text);
    for(const session of Object.values(sessions))session.assertNoCredentialLeaks(text);
    for(const account of Object.values(accounts))assert.ok(!text.includes(account.email),'Action never serializes private account email');
    return {response,text};
  }
  async function deny(label,code,overrides={},settings={}){
    const before=await rows(),beforeCalls=await calls();const result=await invoke(label,overrides,settings);
    if(result.response.status===500&&settings.origin){assert.match(app.diagnostics(),/Invalid Server Actions request/);}
    else assert.ok(result.text.includes('"code":"'+code+'"'),'Guarded creation returns '+code);
    assert.deepEqual(await rows(),before,'Denied action creates no flight');assert.equal(await calls(),beforeCalls,'Denied action never calls creation RPC');
  }
  try{
    for(const [label,role,status,profile] of [['member','member','active',true],['admin','admin','active',true],['disabled','member','disabled',true],['absent',null,'active',false],['noProfile','member','active',false],['adminNoProfile','admin','active',false]]){
      accounts[label]=await stack.createAccount({label:'create-'+label.toLowerCase(),role,status});
      if(profile)await checked(admin.from('profiles').insert({user_id:accounts[label].id,display_name:'Owned Create Pilot',home_airport:'KPAO',pilot_designation:'licensed'}));
      sessions[label]=await signInSession(stack,accounts[label]);
      clients[label]=createClient(stack.apiUrl,stack.publicKey,options);
      const signin=await clients[label].auth.signInWithPassword({email:accounts[label].email,password:accounts[label].password});assert.equal(signin.error,null);
    }
    await scenario('flight_create_native_and_fetched_owner_derived',async()=>{
      for(const [label,transport,visibility] of [['member','native','NETWORK'],['member','fetched','PRIVATE'],['admin','fetched','NETWORK']]){
        const before=await rows(),beforeCalls=await calls();const {text,response}=await invoke(label,{visibility},{transport});
        assert.equal(response.status,200);assert.ok(text.includes('"code":"created"'),'Successful action confirms creation');
        const flightId=text.match(/"flightId":"([a-f0-9-]{36})"/)?.[1];assert.ok(flightId,'Action returns only confirmed flight UUID');
        const after=await rows();assert.equal(after.length,before.length+1);assert.equal(await calls(),beforeCalls+1);
        const row=after.find(r=>r.id===flightId);assert.ok(row);assert.equal(row.owner_id,accounts[label].id);assert.equal(row.status,'open');assert.equal(row.visibility,visibility);assert.equal(row.notes,null);
      }
    });
    await scenario('flight_create_current_access_profile_and_origin_guards',async()=>{
      await deny(null,'unauthenticated');await deny(null,'unauthenticated',{}, {transport:'native'});
      for(const label of ['disabled','absent'])await deny(label,'forbidden');
      for(const label of ['noProfile','adminNoProfile'])await deny(label,'profile_required');
      for(const origin of [null,'https://foreign.example.invalid'])await deny('member','forbidden',{}, {origin});
    });
    await scenario('flight_create_input_bounds_protected_fields_and_past_time',async()=>{
      for(const field of ['owner_id','id','status','created_at','departure_at','recipients','role'])await deny('member','invalid_input',{[field]:'private-canary'});
      await deny('member','invalid_input',{departure_local_date:'2000-01-01'});
      await deny('member','invalid_input',{pilot_places:'0'});
      await deny('member','too_large',{notes:'N'.repeat(17000)});
    });
    const args={p_departure_airport:'KPAO',p_destination_airport:'KPAO',p_departure_at:new Date(Date.now()+86400000).toISOString(),p_departure_timezone:'UTC',p_aircraft_description:'C172',p_pilot_places:1,p_notes:'',p_visibility:'PRIVATE'};
    await scenario('flight_create_direct_rpc_keeps_database_eligibility',async()=>{
      const before=await rows();
      for(const label of ['disabled','absent','noProfile','adminNoProfile']){const result=await clients[label].rpc('create_flight',args).retry(false);assert.equal(result.error?.code,'42501','Direct RPC cannot bypass eligibility');}
      const spoof=await clients.member.rpc('create_flight',{...args,p_owner_id:accounts.admin.id}).retry(false);assert.equal(spoof.error?.code,'PGRST202','RPC accepts no caller-selected owner');
      const anonymous=await createClient(stack.apiUrl,stack.publicKey,options).rpc('create_flight',args).retry(false);assert.equal(anonymous.error?.code,'42501');
      assert.deepEqual(await rows(),before);
      const result=await clients.member.rpc('create_flight',args).retry(false);assert.equal(result.error,null);assert.match(result.data,/^[0-9a-f-]{36}$/);
      assert.equal((await rows()).find(r=>r.id===result.data)?.owner_id,accounts.member.id);
      const retained=sessions.member.cookieHeader();await stack.setMembership(accounts.member.id,{role:'member',status:'disabled'});
      const denied=await clients.member.rpc('create_flight',args).retry(false);assert.equal(denied.error?.code,'42501');assert.equal(sessions.member.cookieHeader(),retained);
      await stack.setMembership(accounts.member.id,{role:'member',status:'active'});
    });
    await scenario('flight_create_database_rechecks_after_server_prechecks',async()=>{
      const before=await rows(),beforeCalls=await calls();await mode('disable:'+accounts.member.id);
      try{const {text}=await invoke('member');assert.ok(text.includes('"code":"forbidden"'));}
      finally{await mode('off');await stack.setMembership(accounts.member.id,{role:'member',status:'active'});}
      assert.deepEqual(await rows(),before,'Revocation after application checks causes no insert');
      assert.equal(await calls(),beforeCalls+1,'Final database check handles the raced eligibility change');
    });
    await scenario('flight_create_invalid_confirmation_is_not_success',async()=>{
      const before=await rows(),beforeCalls=await calls();await mode('malformed');
      try{const {text}=await invoke('member');assert.ok(text.includes('"code":"unavailable"'));assert.ok(!text.includes('private-flight-error-canary'));}
      finally{await mode('off');}
      assert.equal((await rows()).length,before.length+1,'Malformed confirmation may follow a committed flight');
      assert.equal(await calls(),beforeCalls+1,'Malformed confirmation does not trigger another insert');
    });
    await scenario('flight_create_lost_response_is_unconfirmed_without_retry',async()=>{
      const before=await rows(),beforeCalls=await calls();await mode('lost');
      try{const {text}=await invoke('member');assert.ok(text.includes('"code":"unavailable"'));assert.ok(!text.includes('"code":"created"'));}
      finally{await mode('off');}
      assert.equal((await rows()).length,before.length+1,'Response loss can follow one committed flight');
      assert.equal(await calls(),beforeCalls+1,'Write must not retry automatically');
    });
    await scenario('flight_form_page_gates_and_native_validation_recovery',async()=>{
      const anonymous=await app.request('/dashboard/flights/new');assert.equal(anonymous.status,307);
      for(const header of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(anonymous.headers.get(header)??'',/no-store/);
      for(const label of ['noProfile','adminNoProfile','disabled']){
        const html=await (await app.request('/dashboard/flights/new',{session:sessions[label]})).text();
        assert.ok(!html.includes('name="visibility"'),'Ineligible visitors cannot see a posting form');
        if(label!=='disabled')assert.ok(html.includes('Complete your pilot profile first'));
      }
      const before=await rows(),beforeCalls=await calls();
      const {text}=await invoke('member',{visibility:'PRIVATE',recipient_ids:JSON.stringify([accounts.noProfile.id]),departure_local_date:'2030-11-03',departure_local_time:'01:30',departure_timezone:'America/Los_Angeles'},{page:true,transport:'native'});
      assert.ok(text.includes('This local time occurs twice.'));
      assert.ok(text.includes('value="2030-11-03"'),'Native validation failure retains editable date');
      assert.ok(text.includes('flight-departure_occurrence-error'));
      assert.ok(text.includes('aria-invalid="true"'));assert.ok(text.includes('role="alert"'));
      const selected=[...text.matchAll(/<input\b[^>]*>/g)].find(match=>match[0].includes('name="visibility"')&&match[0].includes('value="PRIVATE"'))?.[0];
      assert.match(selected??'',/checked/,'Native validation failure preserves PRIVATE choice');
      assert.deepEqual(await rows(),before);assert.equal(await calls(),beforeCalls);
    });
    await scenario('flight_form_native_and_fetched_publish_result',async()=>{
      for(const transport of ['native','fetched'])for(const visibility of ['NETWORK','PRIVATE']){
        const before=await rows(),beforeCalls=await calls();const {text}=await invoke('member',{visibility,...(visibility==='PRIVATE'?{recipient_ids:JSON.stringify([accounts.noProfile.id])}:{})},{page:true,transport});
        assert.ok(text.includes(visibility==='NETWORK'?'Flight published to the Volo network.':'Private flight published to your selected pilots.'));
        if(transport==='native'){assert.ok(text.includes('Flight reference:'));assert.ok(!text.includes('name="visibility"'),'Confirmed native result removes the submit form');}
        const added=(await rows()).filter(row=>!before.some(old=>old.id===row.id));
        assert.equal(added.length,1);assert.equal(added[0].owner_id,accounts.member.id);assert.equal(added[0].visibility,visibility,'Posting preserves the explicit audience');
        const ownerRead=await checked(clients.member.from('flights').select('id').eq('id',added[0].id));assert.equal(ownerRead.length,1);
        const unrelated=await checked(clients.admin.from('flights').select('id').eq('id',added[0].id));assert.equal(unrelated.length,visibility==='NETWORK'?1:0,'Unrelated active admin has no private bypass');
        if(visibility==='PRIVATE'){
          assert.deepEqual(await checked(admin.from('flight_recipients').select('user_id').eq('flight_id',added[0].id)),[{user_id:accounts.noProfile.id}]);
          assert.equal((await checked(clients.noProfile.from('flights').select('id').eq('id',added[0].id))).length,1,'Selected active pilot can read');
        }
        assert.equal(await calls(),beforeCalls+1);
      }
    });
    await scenario('flight_form_requires_one_approved_visibility_mode',async()=>{
      const html=await (await app.request('/dashboard/flights/new',{session:sessions.member})).text();
      const radios=[...html.matchAll(/<input\b[^>]*>/g)].filter(match=>match[0].includes('name="visibility"'));
      assert.equal(radios.length,2);assert.ok(radios.every(match=>match[0].includes('type="radio"')&&!match[0].includes('checked')),'No silent public default');
      for(const transport of ['native','fetched'])for(const visibility of [undefined,'','GROUP','private','private-canary']){
        const before=await rows(),beforeCalls=await calls();const {text}=await invoke('member',{visibility,...(visibility==='PRIVATE'?{recipient_ids:JSON.stringify([accounts.noProfile.id])}:{})},{page:true,transport});
        assert.ok(text.includes('Choose NETWORK or PRIVATE visibility.'));assert.ok(!text.includes('private-canary'));
        assert.deepEqual(await rows(),before);assert.equal(await calls(),beforeCalls,'Invalid visibility never reaches creation RPC');
      }
    });
    await scenario('flight_picker_private_requires_selection_and_recovers_invalid_selection',async()=>{
      for(const transport of ['native','fetched'])for(const recipient_ids of [undefined,'[]',JSON.stringify([accounts.disabled.id])]){
        const before=await rows(),beforeCalls=await calls();
        const {text}=await invoke('member',{visibility:'PRIVATE',recipient_ids},{page:true,transport});
        assert.ok(text.includes(recipient_ids?.includes(accounts.disabled.id)?'Some selected pilots are no longer eligible.':'Select at least one pilot for a private flight.'));
        if(transport==='native'){
          assert.ok(text.includes('flight-recipient-error'));
          if(recipient_ids?.includes(accounts.disabled.id))assert.ok(text.includes(accounts.disabled.id),'Valid IDs survive a server validation failure');
        }
        assert.deepEqual(await rows(),before,'No invalid private flight is published');
        assert.equal(await calls(),beforeCalls+(recipient_ids?.includes(accounts.disabled.id)?1:0));
      }
      const before=await rows(),beforeCalls=await calls();
      const {text}=await invoke('member',{recipient_ids:JSON.stringify([accounts.admin.id])},{page:true});
      assert.ok(text.includes('Choose valid recipients for a PRIVATE flight.'));assert.deepEqual(await rows(),before);assert.equal(await calls(),beforeCalls,'NETWORK rejects stale recipient payload');
    });
    await scenario('flight_form_uncertain_result_retains_values_and_blocks_submit',async()=>{
      const before=await rows(),beforeCalls=await calls();await mode('lost');
      try{
        const {text}=await invoke('member',{notes:'Owned uncertain form notes'},{page:true,transport:'native'});
        assert.ok(text.includes('Verify your flights before trying again.'));assert.ok(text.includes('Owned uncertain form notes'));
        assert.match(text,/<fieldset[^>]*disabled/,'An unconfirmed result blocks immediate resubmission');
        assert.ok(!text.includes('Flight published to the Volo network.'));
      }finally{await mode('off');}
      assert.equal((await rows()).length,before.length+1);assert.equal(await calls(),beforeCalls+1);
    });
    await verifyRecipientSelection({stack,app,scenario,accounts,sessions,clients,admin,fields});
    await verifyUpcomingFlightFeed({stack,app,scenario,accounts,sessions,admin});
  }finally{
    const ownedFlights=await rows();
    if(ownedFlights.length)await checked(admin.from('flight_recipients').delete().in('flight_id',ownedFlights.map(row=>row.id)));
    await checked(admin.from('flights').delete().in('owner_id',Object.values(accounts).map(a=>a.id)));
    for(const account of Object.values(accounts))await stack.removeOwnedProfile(account.id);
    for(const client of Object.values(clients))await client.auth.stopAutoRefresh();
  }
}
