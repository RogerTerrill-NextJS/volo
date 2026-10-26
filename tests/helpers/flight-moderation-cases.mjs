import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {signInSession} from './real-auth-session.mjs';
import {validateLocalApiUrl} from './local-auth-stack.mjs';

export async function verifyFlightModeration({stack,app,scenario}){
 validateLocalApiUrl(stack.apiUrl,Number(new URL(stack.apiUrl).port));
 const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
 const privileged=createClient(stack.apiUrl,stack.serverSecret,options),accounts={},sessions={},clients={},flights=[];
 const checked=async query=>{const r=await query.retry(false);assert.equal(r.error,null,'Owned moderation fixture operation');return r.data;};
 const mode=async value=>assert.equal((await app.request('/api/moderation-control',{method:'POST',body:value})).status,200);
 const safe=async response=>{
  for(const name of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(response.headers.get(name)??'',/no-store/);
  const text=await response.text();stack.assertNoCredentialLeaks(text);
  for(const session of Object.values(sessions))session.assertNoCredentialLeaks(text);
  for(const a of Object.values(accounts))assert.ok(!text.includes(a.email));
  assert.ok(!text.includes('private-moderation-canary')&&!text.includes('Private retained conversation canary'));
  return text.replaceAll('&quot;','"');
 };
 const act=async(label,flight,fields={},settings={})=>safe(await app.hideFlight({flight_id:flight,reason:'Owned moderation safety review',confirmation:'hide',...fields},{session:sessions[label],...settings}));
 const code=(text,expected)=>assert.ok(text.includes('"code":"'+expected+'"'),'Moderation outcome '+expected);
 const overview=async(label='admin',after)=>JSON.parse(await safe(await app.request('/api/moderation-overview'+(after?'?after='+after:''),{session:sessions[label]})));
 const readFlight=id=>checked(privileged.from('flights').select('*').eq('id',id).single());
 const audits=async id=>checked(clients.admin.from('flight_moderation_audit').select('*').eq('flight_id',id));
 const rpc=(label,name,args)=>clients[label].rpc(name,args).retry(false);
 const run=(name,fn)=>scenario(name,async()=>{for(const session of Object.values(sessions))await session.refresh();await fn();});
 const createFlight=async(visibility='NETWORK')=>{
  const id=randomUUID();flights.push(id);
  await checked(privileged.from('flights').insert({id,owner_id:accounts.owner.id,departure_airport:'KPAO',destination_airport:'KSQL',departure_at:new Date(Date.now()+86400000).toISOString(),departure_timezone:'UTC',aircraft_description:'Owned moderation C172',pilot_places:3,visibility,notes:'Retained post note'}));
  return id;
 };
 const request=async(flight,label,status='pending')=>{
  if((await readFlight(flight)).visibility==='PRIVATE')await checked(privileged.from('flight_recipients').insert({flight_id:flight,user_id:accounts[label].id}));
  const id=randomUUID();await checked(privileged.from('flight_requests').insert({id,flight_id:flight,requester_id:accounts[label].id,introductory_note:'Retained introductory note'}));
  if(status!=='pending')await checked(privileged.from('flight_requests').update({status}).eq('id',id));return id;
 };
 const thread=async request=>{const r=await rpc('requester','get_or_create_flight_conversation',{p_request_id:request});assert.equal(r.error,null);return r.data;};
 try{
  for(const [label,role,status] of [['admin','admin','active'],['peer','admin','active'],['owner','member','active'],['requester','member','active'],['pending','member','active'],['other','member','active'],['disabled','admin','disabled'],['absent',null,'active']]){
   accounts[label]=await stack.createAccount({label:'moderation-'+label,role,status});sessions[label]=await signInSession(stack,accounts[label]);
   clients[label]=createClient(stack.apiUrl,stack.publicKey,options);assert.equal((await clients[label].auth.signInWithPassword({email:accounts[label].email,password:accounts[label].password})).error,null);
   if(role)await checked(privileged.from('profiles').insert({user_id:accounts[label].id,display_name:'Owned moderation '+label,home_airport:'KPAO',pilot_designation:'licensed'}));
  }
  await run('flight_moderation_current_admin_action_overview_and_direct_bypass_guards',async()=>{
   const flight=await createFlight('PRIVATE'),before=await readFlight(flight),formHtml=await(await app.request('/admin/moderation-fixture',{session:sessions.admin})).text();
   await sessions.owner.setAdmissionMetadata();
   for(const label of ['owner','other','disabled','absent']){
    assert.equal((await overview(label)).status,'forbidden');code(await act(label,flight,{}, {formHtml}),'forbidden');
    assert.equal((await rpc(label,'admin_hide_flight',{p_flight_id:flight,p_reason:'Direct bypass'})).error?.code,'42501');
    assert.deepEqual(await checked(clients[label].from('flight_moderation_audit').select('*')),[]);
   }
   code(await act(undefined,flight,{}, {formHtml}),'unauthenticated');code(await act('admin',flight,{}, {origin:null}),'forbidden');
   for(const fields of [{actor_id:accounts.owner.id},{status:'cancelled'},{moderated_at:'2000-01-01'},{confirmation:''},{reason:' '},{reason:'x'.repeat(501)}])code(await act('admin',flight,fields),'invalid_input');
   code(await act('admin',randomUUID()),'flight_unavailable');
   assert.deepEqual(await checked(clients.admin.from('flights').select('id').eq('id',flight)),[],'No ordinary PRIVATE admin bypass');
   assert.equal((await clients.admin.from('flights').update({moderated_at:new Date().toISOString()}).eq('id',flight).retry(false)).error?.code,'42501');
   assert.equal((await privileged.rpc('admin_hide_flight',{p_flight_id:flight,p_reason:'Service bypass'}).retry(false)).error?.code,'42501');
   const list=await overview();assert.ok(list.rows.some(r=>r.id===flight&&r.notes==='Retained post note'));
   assert.equal((await overview('admin','invalid')).status,'invalid');
   await mode('overview-malformed');try{assert.equal((await overview()).status,'unavailable');}finally{await mode('off');}
   assert.deepEqual(await readFlight(flight),before);assert.deepEqual(await audits(flight),[]);
  });
  await run('flight_moderation_native_private_closure_preserves_participant_history',async()=>{
   const flight=await createFlight('PRIVATE'),accepted=await request(flight,'requester','accepted'),pending=await request(flight,'pending'),conversation=await thread(accepted),message=randomUUID();
   assert.equal((await rpc('requester','send_conversation_message',{p_conversation_id:conversation,p_message_id:message,p_body:'Private retained conversation canary'})).error,null);
   code(await act('admin',flight,{}, {transport:'native'}),'hidden');
   const stored=await readFlight(flight),events=await audits(flight);assert.equal(stored.status,'cancelled');assert.ok(stored.moderated_at);assert.equal(stored.notes,'Retained post note');
   assert.equal(events.length,1);assert.equal(events[0].actor_id,accounts.admin.id);assert.equal(events[0].reason,'Owned moderation safety review');assert.equal(events[0].created_at,stored.moderated_at);
   for(const label of ['requester','pending','other','admin'])assert.deepEqual(await checked(clients[label].from('flights').select('id').eq('id',flight)),[]);
   assert.equal((await checked(clients.owner.from('flights').select('id').eq('id',flight))).length,1);
   for(const id of [accepted,pending])assert.equal((await checked(privileged.from('flight_requests').select('status').eq('id',id).single())).status,'cancelled');
   assert.ok((await checked(clients.requester.from('conversations').select('closed_at').eq('id',conversation).single())).closed_at);
   assert.equal((await checked(clients.requester.from('messages').select('body').eq('id',message).single())).body,'Private retained conversation canary');
   assert.equal((await checked(clients.owner.from('messages').select('id').eq('id',message))).length,1);
   assert.deepEqual(await checked(clients.admin.from('messages').select('*').eq('id',message)),[]);
   assert.deepEqual(await checked(clients.admin.from('conversations').select('*').eq('id',conversation)),[]);
   assert.equal((await rpc('requester','send_conversation_message',{p_conversation_id:conversation,p_message_id:randomUUID(),p_body:'After hide'})).error?.code,'42501');
   assert.equal((await rpc('requester','get_or_create_flight_conversation',{p_request_id:accepted})).error?.code,'42501');
   assert.equal((await rpc('requester','get_flight_connection',{p_request_id:accepted})).data,null);
   assert.equal((await rpc('pending','submit_flight_interest',{p_flight_id:flight})).data?.code,'flight_unavailable');
   assert.equal((await rpc('owner','decide_flight_request',{p_flight_id:flight,p_request_id:pending,p_decision:'accepted'})).data?.code,'request_conflict');
   assert.equal((await checked(privileged.from('flight_recipients').select('*').eq('flight_id',flight))).length,2);
   assert.ok((await overview()).rows.some(r=>r.id===flight&&r.moderated_at===stored.moderated_at));
   code(await act('peer',flight,{reason:'Changed retry'}),'already_hidden');assert.deepEqual(await readFlight(flight),stored);assert.deepEqual(await audits(flight),events);
  });
  await run('flight_moderation_network_discovery_and_terminal_lifecycle',async()=>{
   const flight=await createFlight(),declined=await request(flight,'requester','declined'),withdrawn=await request(flight,'pending','withdrawn');
   const history=await checked(privileged.from('flight_requests').select('*').in('id',[declined,withdrawn]).order('id'));
   const feed=async label=>JSON.parse(await safe(await app.request('/api/moderation-feed',{session:sessions[label]})));
   assert.ok((await feed('other')).rows.some(r=>r.id===flight));code(await act('admin',flight),'hidden');
   assert.ok(!(await feed('other')).rows.some(r=>r.id===flight));assert.ok(!(await feed('owner')).rows.some(r=>r.id===flight));
   assert.deepEqual(await checked(privileged.from('flight_requests').select('*').in('id',[declined,withdrawn]).order('id')),history);
   assert.equal((await rpc('pending','submit_flight_interest',{p_flight_id:flight})).data?.code,'flight_unavailable');
   for(const status of ['completed','cancelled']){const terminal=await createFlight();await checked(privileged.from('flights').update({status,departure_at:new Date(Date.now()-86400000).toISOString()}).eq('id',terminal));code(await act('admin',terminal),'hidden');assert.equal((await readFlight(terminal)).status,status);}
  });
  await run('flight_moderation_lost_response_and_stale_admin',async()=>{
   for(const fault of ['lost','malformed']){
    const flight=await createFlight();await mode(fault);try{code(await act('admin',flight),'moderation_unconfirmed');}finally{await mode('off');}
    assert.ok((await overview()).rows.some(r=>r.id===flight&&r.moderated_at));code(await act('admin',flight),'already_hidden');assert.equal((await audits(flight)).length,1);
   }
   const flight=await createFlight(),before=await readFlight(flight);await mode('disable-actor:'+accounts.admin.id);
   try{code(await act('admin',flight),'forbidden');assert.deepEqual(await readFlight(flight),before);}finally{await mode('off');await stack.setMembership(accounts.admin.id,{role:'admin',status:'active'});}
  });
  await run('flight_moderation_concurrent_hide_accept_and_send',async()=>{
   const flight=await createFlight(),accepted=await request(flight,'requester','accepted'),pending=await request(flight,'pending'),conversation=await thread(accepted),message=randomUUID();
   const results=await Promise.all([
    rpc('admin','admin_hide_flight',{p_flight_id:flight,p_reason:'Concurrent moderation'}),
    rpc('peer','admin_hide_flight',{p_flight_id:flight,p_reason:'Other moderator'}),
    rpc('owner','decide_flight_request',{p_flight_id:flight,p_request_id:pending,p_decision:'accepted'}),
    rpc('requester','send_conversation_message',{p_conversation_id:conversation,p_message_id:message,p_body:'Concurrent permitted-before-closure message'}),
   ]);
   assert.deepEqual(results.slice(0,2).map(r=>r.data?.code).sort(),['already_hidden','hidden']);assert.equal(results[0].data.moderatedAt,results[1].data.moderatedAt);
   assert.ok(['accepted','request_conflict'].includes(results[2].data?.code));assert.ok(results[3].error===null||results[3].error?.code==='42501');
   assert.equal((await audits(flight)).length,1);assert.equal((await readFlight(flight)).status,'cancelled');
   assert.equal((await checked(privileged.from('flight_requests').select('*').eq('flight_id',flight))).filter(r=>['pending','accepted'].includes(r.status)).length,0);
   assert.ok((await checked(clients.requester.from('conversations').select('closed_at').eq('id',conversation).single())).closed_at);
   assert.equal((await rpc('requester','send_conversation_message',{p_conversation_id:conversation,p_message_id:randomUUID(),p_body:'After concurrent hide'})).error?.code,'42501');
  });
 }finally{
  await mode('off');
  if(accounts.owner){await stack.removeOwnedConversations(accounts.owner.id);await stack.removeOwnedFlightModeration(accounts.owner.id);}
  if(flights.length){await checked(privileged.from('flight_requests').delete().in('flight_id',flights));await checked(privileged.from('flight_recipients').delete().in('flight_id',flights));await checked(privileged.from('flights').delete().in('id',flights));}
  for(const account of Object.values(accounts))await stack.removeOwnedProfile(account.id);
  for(const client of Object.values(clients)){client.auth.stopAutoRefresh();client.realtime.disconnect();}
 }
}
