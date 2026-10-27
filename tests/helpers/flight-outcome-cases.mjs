import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createClient} from '@supabase/supabase-js';
import {signInSession} from './real-auth-session.mjs';
import {localProcessEnvironment,validateLocalApiUrl} from './local-auth-stack.mjs';
const exec=promisify(execFile);
export async function verifyFlightOutcomes({stack,app,scenario}){
 validateLocalApiUrl(stack.apiUrl,Number(new URL(stack.apiUrl).port));
 const container='supabase_db_'+stack.projectId,env=localProcessEnvironment();
 assert.equal((await exec('docker',['inspect','--format','{{ index .Config.Labels "com.supabase.cli.project" }}',container],{env})).stdout.trim(),stack.projectId);
 const sql=async statement=>(await exec('docker',['exec',container,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-qAt','-c',statement],{env})).stdout.trim();
 const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}},service=createClient(stack.apiUrl,stack.serverSecret,options),accounts={},clients={},sessions={},flights=[],requests=[];
 const checked=async query=>{const r=await query.retry(false);assert.equal(r.error,null,'Owned outcome fixture operation');return r.data;};
 const safe=async response=>{for(const h of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(response.headers.get(h)??'',/no-store/);const text=await response.text();stack.assertNoCredentialLeaks(text);for(const s of Object.values(sessions))s.assertNoCredentialLeaks(text);return text;};
 const read=(label,id=requests[0])=>checked(clients[label].rpc('get_flight_outcome',{p_request_id:id}));
 const metrics=()=>checked(clients.admin.rpc('admin_mvp_metrics'));
 const fields=(id,answer,revision)=>({request_id:id,answer,expected_revision:String(revision)});
 const html=async label=>safe(await app.request('/dashboard/outcomes',{session:sessions[label]}));
 const act=async(label,input,settings={})=>safe(await app.outcomePageAction(input,{session:sessions[label],...settings}));
 const mode=async value=>assert.equal((await app.request('/api/outcome-control',{method:'POST',body:value})).status,200);
 let baseline;
 try{
  for(const [name,role] of [['admin','admin'],['owner','member'],['requester','member'],['outsider','admin']]){
   const a=accounts[name]=await stack.createAccount({label:'outcome-'+name,role}),c=clients[name]=createClient(stack.apiUrl,stack.publicKey,options);
   assert.equal((await c.auth.signInWithPassword({email:a.email,password:a.password})).error,null);sessions[name]=await signInSession(stack,a);
   await checked(service.from('profiles').insert({user_id:a.id,display_name:name==='requester'?'<Outcome pilot>':'Owned outcome '+name,home_airport:'KPAO',pilot_designation:'licensed'}));
  }
  baseline=await metrics();
  for(let i=0;i<2;i++){
   const flight=randomUUID();flights.push(flight);
   await checked(service.from('flights').insert({id:flight,owner_id:accounts.owner.id,departure_airport:'KPAO',destination_airport:'KSQL',departure_at:new Date(Date.now()+7*86400000).toISOString(),departure_timezone:'America/Los_Angeles',aircraft_description:'Owned outcome aircraft',pilot_places:1,visibility:'PRIVATE'}));
   await checked(service.from('flight_recipients').insert({flight_id:flight,user_id:accounts.requester.id}));
   const r=await checked(clients.requester.rpc('submit_flight_interest',{p_flight_id:flight}));requests.push(r.requestId);
   await checked(clients.owner.rpc('decide_flight_request',{p_flight_id:flight,p_request_id:r.requestId,p_decision:'accepted'}));
  }
  await scenario('outcomes_after_date_native_and_fetched_own_answer_and_metrics',async()=>{
   assert.equal(await read('owner'),null);
   // Elapsed time is simulated only in the owned project; restore the guard before requests.
   await sql(`alter table public.flights disable trigger flights_prepare;update public.flights set departure_at=now()-interval '2 days',departure_local_date=((now()-interval '2 days') at time zone departure_timezone)::date where id in('${flights.join("','")}');alter table public.flights enable trigger flights_prepare;`);
   const before=await html('owner');assert.ok(before.includes('Did you fly together on this flight?')&&before.includes('&lt;Outcome pilot&gt;'));assert.ok(!before.includes('<Outcome pilot>'));
   const native=await act('owner',fields(requests[0],'yes',0),{transport:'native'});assert.ok(native.includes('Your answer is saved'));
   const forms=[...native.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)];
   assert.ok(forms.some(m=>m[1].includes('name="request_id"')&&m[1].includes('value="'+requests[1]+'"')),'Other connection remains editable after native save');
   const otherItem=native.split('id="outcome-'+requests[1]+'"')[1]?.split('</li>')[0]??'';assert.ok(otherItem&&!otherItem.includes('Your answer is saved'),'Other native item has no saved feedback');
   assert.equal((await read('requester')).answer,null);
   assert.ok((await act('requester',fields(requests[0],'yes',0))).includes('Your answer is saved'));
   let m=await metrics();assert.equal(m.outcomeResponses,baseline.outcomeResponses+2);assert.equal(m.confirmedConnections,baseline.confirmedConnections+1);assert.equal(m.bothParticipantsConfirmed,baseline.bothParticipantsConfirmed+1);
   assert.ok((await act('owner',fields(requests[0],'no',1),{transport:'native'})).includes('Your answer is saved'));
   assert.equal((await read('owner')).answer,false);assert.equal((await read('requester')).answer,true);
   m=await metrics();assert.equal(m.oneParticipantConfirmed,baseline.oneParticipantConfirmed+1);assert.equal(m.conflictingConnections,baseline.conflictingConnections+1);assert.equal(m.bothParticipantsConfirmed,baseline.bothParticipantsConfirmed);
   const adminPage=await safe(await app.request('/admin/metrics',{session:sessions.admin}));assert.ok(adminPage.includes('Participant-reported flying outcomes')&&!adminPage.includes('Owned outcome aircraft'));
  });
  await scenario('outcomes_lost_confirmation_read_recovery_stale_and_concurrent_retries',async()=>{
   const input=fields(requests[1],'yes',0);await mode('lost');try{assert.ok((await act('owner',input)).includes('We could not confirm whether your answer was saved'),'Lost-response feedback is shown');}finally{await mode('off');}
   const current=await read('owner',requests[1]);assert.equal(current.answer,true);assert.equal(current.revision,1);const recovered=await html('owner');const item=recovered.split('id="outcome-'+requests[1]+'"')[1]?.split('</li>')[0]??'';assert.ok(item.replaceAll('<!-- -->','').includes('Your saved answer: Yes'),'Recovery GET shows committed own answer on exact connection');
   await act('owner',input);assert.deepEqual(await read('owner',requests[1]),current);
   assert.ok((await act('owner',fields(requests[0],'yes',1))).includes('Your answer changed in another tab'),'Stale correction feedback is shown');assert.equal((await read('owner')).answer,false);
   const concurrent=await Promise.all([true,false].map(answer=>checked(clients.requester.rpc('save_flight_outcome',{p_request_id:requests[1],p_flew_together:answer,p_expected_revision:0}))));
   assert.deepEqual(concurrent.map(r=>r.code).sort(),['saved','stale']);assert.equal((await read('requester',requests[1])).revision,1);
   assert.equal((await metrics()).outcomeResponses,baseline.outcomeResponses+4);
  });
  await scenario('outcomes_direct_action_origin_actor_audience_and_status_guards',async()=>{
   const ownerHtml=await html('owner'),input=fields(requests[0],'yes',2),before=await read('owner');
   await act('owner',input,{origin:'https://untrusted.example',formHtml:ownerHtml});assert.deepEqual(await read('owner'),before);
   assert.equal(await read('outsider'),null);assert.deepEqual(await checked(clients.outsider.rpc('list_flight_outcomes')),[]);
   assert.ok((await act('outsider',input,{formHtml:ownerHtml})).includes('This outcome is no longer available'));
   assert.equal((await clients.owner.from('flight_outcomes').select('*')).error?.code,'42501');
   await stack.setMembership(accounts.requester.id,{role:'member',status:'disabled'});
   assert.equal(await read('owner'),null);assert.ok((await act('owner',input,{formHtml:ownerHtml})).includes('This outcome is no longer available'));
   await stack.setMembership(accounts.requester.id,{role:'member',status:'active'});
   await checked(clients.owner.rpc('change_flight_recipient',{p_flight_id:flights[0],p_recipient_id:accounts.requester.id,p_selected:false}));
   assert.equal(await read('owner'),null);assert.equal(await read('requester'),null);assert.ok((await act('owner',input,{formHtml:ownerHtml})).includes('This outcome is no longer available'));
   const m=await metrics();assert.equal(m.outcomeResponses,baseline.outcomeResponses+4,'Closure retains minimal historical responses');
   const race=await Promise.all([
    checked(clients.owner.rpc('save_flight_outcome',{p_request_id:requests[1],p_flew_together:false,p_expected_revision:1})),
    checked(clients.requester.rpc('withdraw_flight_request',{p_flight_id:flights[1],p_request_id:requests[1]})),
   ]);
   assert.ok(['saved','outcome_unavailable'].includes(race[0].code));assert.equal(await read('owner',requests[1]),null);
   assert.equal((await checked(clients.owner.rpc('save_flight_outcome',{p_request_id:requests[1],p_flew_together:true,p_expected_revision:1}))).code,'outcome_unavailable');
  });
 }finally{
  await mode('off');
  if(requests.length)await sql(`delete from public.flight_outcomes where request_id in('${requests.join("','")}');`);
  for(const a of Object.values(accounts))await stack.removeOwnedConversations(a.id);
  if(flights.length){await checked(service.from('flight_requests').delete().in('flight_id',flights));await checked(service.from('flight_recipients').delete().in('flight_id',flights));await checked(service.from('flights').delete().in('id',flights));}
  for(const a of Object.values(accounts))await stack.removeOwnedProfile(a.id);
 }
}
