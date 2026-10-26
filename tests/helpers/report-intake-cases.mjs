import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {signInSession} from './real-auth-session.mjs';
import {validateLocalApiUrl} from './local-auth-stack.mjs';

export async function verifyReportIntake({stack,app,scenario}){
 validateLocalApiUrl(stack.apiUrl,Number(new URL(stack.apiUrl).port));
 const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}},privileged=createClient(stack.apiUrl,stack.serverSecret,options),accounts={},sessions={},clients={},flights=[];
 let privateFlight,networkFlight,requestId,conversation,messageId;
 const checked=async query=>{const r=await query.retry(false);assert.equal(r.error,null,'Owned report fixture operation');return r.data;};
 const safe=async response=>{for(const name of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(response.headers.get(name)??'',/no-store/);const text=await response.text();stack.assertNoCredentialLeaks(text);for(const session of Object.values(sessions))session.assertNoCredentialLeaks(text);for(const a of Object.values(accounts))assert.ok(!text.includes(a.email));assert.ok(!text.includes('private-report-canary')&&!text.includes('Uncopied private message canary'));return text;};
 const mode=async value=>assert.equal((await app.request('/api/report-control',{method:'POST',body:value})).status,200);
 const code=(text,expected)=>assert.ok(text.replaceAll('&quot;','"').includes('"code":"'+expected+'"'),'Report outcome '+expected);
 const fields=(id,targetType='pilot',targetId=accounts.owner.id,reason='Owned safety concern')=>({report_id:id,target_type:targetType,target_id:targetId,reason});
 const act=async(label,input,settings={})=>safe(await app.submitReport(input,{session:sessions[label],...settings}));
 const list=async(label='reporter',after)=>JSON.parse(await safe(await app.request('/api/report-list'+(after?'?after='+after:''),{session:sessions[label]})));
 const reports=label=>checked(clients[label].from('reports').select('*').order('id'));
 const rpc=(label,input)=>clients[label].rpc('submit_report',{p_report_id:input.report_id,p_target_type:input.target_type,p_target_id:input.target_id,p_reason:input.reason}).retry(false);
 const run=(name,fn)=>scenario(name,async()=>{for(const session of Object.values(sessions))await session.refresh();await fn();});
 try{
  for(const [label,role,status] of [['owner','member','active'],['reporter','member','active'],['other','member','active'],['admin','admin','active'],['disabled','member','disabled'],['absent',null,'active'],['noProfile','member','active']]){
   accounts[label]=await stack.createAccount({label:'report-'+label.toLowerCase(),role,status});sessions[label]=await signInSession(stack,accounts[label]);clients[label]=createClient(stack.apiUrl,stack.publicKey,options);assert.equal((await clients[label].auth.signInWithPassword({email:accounts[label].email,password:accounts[label].password})).error,null);
   if(role&&label!=='noProfile')await checked(privileged.from('profiles').insert({user_id:accounts[label].id,display_name:'Owned report '+label,home_airport:'KPAO',pilot_designation:'licensed'}));
  }
  for(const visibility of ['NETWORK','PRIVATE']){const id=randomUUID();flights.push(id);await checked(privileged.from('flights').insert({id,owner_id:accounts.owner.id,departure_airport:'KPAO',destination_airport:'KSQL',departure_at:new Date(Date.now()+86400000).toISOString(),departure_timezone:'UTC',aircraft_description:'Owned report C172',pilot_places:2,visibility,notes:'Post content is never copied'}));if(visibility==='PRIVATE')privateFlight=id;else networkFlight=id;}
  await checked(privileged.from('flight_recipients').insert({flight_id:privateFlight,user_id:accounts.reporter.id}));
  requestId=randomUUID();await checked(privileged.from('flight_requests').insert({id:requestId,flight_id:privateFlight,requester_id:accounts.reporter.id}));await checked(privileged.from('flight_requests').update({status:'accepted'}).eq('id',requestId));
  const thread=await clients.reporter.rpc('get_or_create_flight_conversation',{p_request_id:requestId}).retry(false);assert.equal(thread.error,null);conversation=thread.data;messageId=randomUUID();assert.equal((await clients.owner.rpc('send_conversation_message',{p_conversation_id:conversation,p_message_id:messageId,p_body:'Uncopied private message canary'}).retry(false)).error,null);
  await run('metrics_authorized_aggregates_privacy_reload_and_current_role_guards',async()=>{
   const snapshot=await checked(clients.admin.rpc('admin_mvp_metrics'));const {asOf,...counts}=snapshot;assert.ok(Number.isFinite(Date.parse(asOf)));
   assert.deepEqual(counts,{invitedPilots:0,activatedPilots:0,activeMembers:5,completedProfiles:5,activeProfiles:4,flightPosts:2,interestRequests:1,currentAcceptedRequests:1,recordedAcceptedRequests:1,messages:1,messagingConversations:1,outcomes:'not_collected'});
   const page=await safe(await app.request('/admin/metrics',{session:sessions.admin}));assert.ok(page.includes('MVP metrics')&&page.includes('Real-world flying outcomes: not collected'));assert.ok(!page.includes('Owned report C172')&&!page.includes('Owned report reporter'));
   const read=async label=>(await(await app.request('/api/metrics',{session:sessions[label]})).json());
   const report=await read('admin');assert.equal(report.status,'authorized');const {asOf:date,...reported}=report.report;assert.ok(Number.isFinite(Date.parse(date)));assert.deepEqual(reported,counts);
   assert.deepEqual(await checked(clients.admin.from('messages').select('body')),[],'Aggregate permission does not expose private messages');
   for(const label of ['owner','reporter','other','noProfile','disabled','absent']){
    assert.equal((await read(label)).status,'forbidden');assert.equal((await clients[label].rpc('admin_mvp_metrics').retry(false)).error?.code,'42501');
    const denied=await safe(await app.request('/admin/metrics',{session:sessions[label]}));assert.ok(!denied.includes('Snapshot')&&!denied.includes('Real-world flying outcomes: not collected'));
   }
   await mode('metrics-outage');try{assert.equal((await read('admin')).status,'unavailable');const failure=await safe(await app.request('/admin/metrics',{session:sessions.admin}));assert.ok(failure.includes('Metrics temporarily unavailable'));assert.ok(!failure.includes('private-metrics-error-canary'));}finally{await mode('off');}
   assert.equal((await read('admin')).status,'authorized');
   await stack.setMembership(accounts.admin.id,{role:'member',status:'active'});try{assert.equal((await read('admin')).status,'forbidden');assert.equal((await clients.admin.rpc('admin_mvp_metrics').retry(false)).error?.code,'42501');}finally{await stack.setMembership(accounts.admin.id,{role:'admin',status:'active'});}
   await stack.setMembership(accounts.admin.id,{role:'admin',status:'disabled'});try{assert.equal((await read('admin')).status,'forbidden');assert.equal((await clients.admin.rpc('admin_mvp_metrics').retry(false)).error?.code,'42501');}finally{await stack.setMembership(accounts.admin.id,{role:'admin',status:'active'});}
  });
  await run('report_intake_origin_membership_input_and_direct_bypass_guards',async()=>{
   const formHtml=await(await app.request('/dashboard/report-fixture',{session:sessions.reporter})).text(),input=fields(randomUUID());
   await sessions.other.setAdmissionMetadata();
   for(const label of ['disabled','absent']){code(await act(label,input,{formHtml}),'forbidden');assert.equal((await list(label)).status,'forbidden');assert.equal((await rpc(label,input)).error?.code,'42501');}
   code(await act(undefined,input,{formHtml}),'unauthenticated');code(await act('reporter',input,{origin:null}),'forbidden');
   for(const extra of [{reporter_id:accounts.other.id},{role:'admin'},{created_at:'2000-01-01'},{status:'resolved'},{report_id:'bad'},{target_type:'conversation'},{reason:' '},{reason:'x'.repeat(2001)}])code(await act('reporter',{...input,...extra}),'invalid_input');
   assert.equal((await clients.reporter.from('reports').insert({id:randomUUID(),reporter_id:accounts.other.id,target_type:'pilot',target_id:accounts.owner.id,reason:'Forged'}).retry(false)).error?.code,'42501');
   assert.equal((await privileged.rpc('submit_report',{p_report_id:input.report_id,p_target_type:'pilot',p_target_id:accounts.owner.id,p_reason:'Service bypass'}).retry(false)).error?.code,'42501');
   assert.deepEqual(await reports('admin'),[]);code(await act('noProfile',fields(randomUUID())),'reported');
  });
  await run('report_intake_native_fetched_targets_and_reporter_admin_privacy',async()=>{
   const native=fields(randomUUID()),flight=fields(randomUUID(),'flight',privateFlight),message=fields(randomUUID(),'message',messageId);
   code(await act('reporter',native,{transport:'native'}),'reported');code(await act('reporter',flight),'reported');code(await act('reporter',message),'reported');
   const stored=await reports('reporter');assert.equal(stored.length,3);for(const row of stored){assert.equal(row.reporter_id,accounts.reporter.id);assert.ok(row.created_at);assert.equal(row.reason,'Owned safety concern');assert.ok(!('body' in row)&&!('snapshot' in row));}
   assert.equal((await list('reporter')).rows.length,3);assert.deepEqual(await reports('other'),[]);assert.equal((await list('admin')).rows.length,4);
   const before=stored.find(r=>r.id===flight.report_id);code(await act('reporter',flight),'already_reported');code(await act('reporter',{...flight,reason:'Changed reason'}),'report_conflict');code(await act('other',flight),'report_conflict');assert.deepEqual((await reports('reporter')).find(r=>r.id===flight.report_id),before);
   for(const label of ['other','admin']){
    for(const [kind,target] of [['flight',privateFlight],['message',messageId]])code(await act(label,fields(randomUUID(),kind,target)),'target_unavailable');
    assert.deepEqual(await checked(clients[label].from('messages').select('id').eq('id',messageId)),[]);assert.deepEqual(await checked(clients[label].from('conversations').select('id').eq('id',conversation)),[]);
   }
   const live=await checked(privileged.from('flights').select('status,moderated_at').eq('id',privateFlight).single());assert.deepEqual(live,{status:'open',moderated_at:null});assert.equal((await checked(privileged.from('flight_requests').select('status').eq('id',requestId).single())).status,'accepted');
   assert.equal((await checked(clients.reporter.from('messages').select('body').eq('id',messageId).single())).body,'Uncopied private message canary');
   assert.equal((await clients.admin.from('reports').update({reason:'Rewrite'}).eq('id',native.report_id).retry(false)).error?.code,'42501');assert.equal((await clients.admin.from('reports').delete().eq('id',native.report_id).retry(false)).error?.code,'42501');
  });
  await run('report_support_actual_entry_links_native_fetched_and_founder_privacy',async()=>{
   assert.match(await safe(await app.request('/reports',{session:sessions.reporter})),/Start from the item/);
   const link=(kind,id)=>'/reports?target_type='+kind+'&amp;target_id='+id;
   assert.ok((await safe(await app.request('/directory/'+accounts.owner.id,{session:sessions.reporter}))).includes(link('pilot',accounts.owner.id)));
   assert.ok((await safe(await app.request('/dashboard/flights/'+privateFlight,{session:sessions.reporter}))).includes(link('flight',privateFlight)));
   const history=await(await app.request('/messages/'+conversation,{session:sessions.reporter})).text();stack.assertNoCredentialLeaks(history);assert.ok(history.includes(link('message',messageId)));
   const canonical=await app.request('/reports?target_type=pilot&target_id='+accounts.owner.id,{session:sessions.reporter});assert.equal(canonical.status,307);const destination=new URL(canonical.headers.get('location'),app.origin);assert.equal(destination.origin,app.origin);assert.ok(destination.searchParams.get('report_id'));
   for(const [kind,target,transport] of [['pilot',accounts.owner.id,'native'],['flight',networkFlight,'fetched']]){
    const input=fields(randomUUID(),kind,target,'<script>Owned report text</script>'),result=await safe(await app.reportPageAction(input,{session:sessions.reporter,transport}));assert.match(result,/Report received/);assert.ok(!result.includes('name="reason"'));const recovered=await safe(await app.request('/reports?'+new URLSearchParams({target_type:kind,target_id:target,report_id:input.report_id}),{session:sessions.reporter}));assert.match(recovered,/Report received/);assert.ok(!recovered.includes('name="reason"'));
   }
   const adminPage=await safe(await app.request('/admin/reports',{session:sessions.admin}));assert.ok(adminPage.includes('&lt;script&gt;Owned report text&lt;/script&gt;'));assert.ok(!adminPage.includes('<script>Owned report text</script>'));assert.match(adminPage,/Message references do not grant access/);assert.ok(!adminPage.includes('/messages/'+conversation));
   for(const label of ['reporter','disabled','absent']){const denied=await safe(await app.request('/admin/reports',{session:sessions[label]}));assert.ok(!denied.includes('Owned report text')&&!denied.includes('Reporter member ID'));}
   const own=(await reports('reporter'))[0],foreign=await safe(await app.request('/reports?'+new URLSearchParams({target_type:own.target_type,target_id:own.target_id,report_id:own.id}),{session:sessions.admin}));assert.ok(!foreign.includes('Report received')&&!foreign.includes(own.reason));
   const invalid=await safe(await app.request('/reports?target_type=message&target_id=bad',{session:sessions.reporter}));assert.match(invalid,/This report link is unavailable/);assert.ok(!invalid.includes('name="reason"'));
  });
  await run('report_support_uncertain_native_receipt_recovery_and_stale_authority',async()=>{
   for(const fault of ['lost','malformed']){
    const input=fields(randomUUID()),route='/reports?'+new URLSearchParams({target_type:input.target_type,target_id:input.target_id,report_id:input.report_id});await mode(fault);
    try{const result=await safe(await app.reportPageAction(input,{session:sessions.reporter,transport:'native'}));assert.match(result,/Check report status/);assert.ok(!result.includes('name="reason"'));}finally{await mode('off');}
    assert.match(await safe(await app.request(route,{session:sessions.reporter})),/Report received/);assert.equal((await reports('reporter')).filter(r=>r.id===input.report_id).length,1);
   }
   const input=fields(randomUUID()),route='/reports?'+new URLSearchParams({target_type:input.target_type,target_id:input.target_id,report_id:input.report_id}),formHtml=await safe(await app.request(route,{session:sessions.reporter}));await mode('disable-actor:'+accounts.reporter.id);
   try{const result=await safe(await app.reportPageAction(input,{session:sessions.reporter,formHtml}));assert.ok(!result.includes('Report received'));assert.ok(!(await reports('admin')).some(r=>r.id===input.report_id));}finally{await mode('off');await stack.setMembership(accounts.reporter.id,{role:'member',status:'active'});}
   await mode('list-malformed');try{const result=await safe(await app.request(route,{session:sessions.reporter}));assert.match(result,/Report status temporarily unavailable/);assert.ok(!result.includes('name="reason"'));}finally{await mode('off');}
  });
  await run('report_intake_current_target_visibility_and_retained_message_history',async()=>{
   const receipt=(await reports('reporter')).find(r=>r.target_type==='flight'&&r.target_id===privateFlight);
   assert.equal((await clients.owner.rpc('change_flight_recipient',{p_flight_id:privateFlight,p_recipient_id:accounts.reporter.id,p_selected:false}).retry(false)).error,null);
   code(await act('reporter',fields(randomUUID(),'flight',privateFlight)),'target_unavailable');code(await act('reporter',fields(receipt.id,'flight',privateFlight)),'already_reported');assert.match(await safe(await app.request('/reports?'+new URLSearchParams({target_type:'flight',target_id:privateFlight,report_id:receipt.id}),{session:sessions.reporter})),/Report received/);
   code(await act('reporter',fields(randomUUID(),'message',messageId)),'reported');assert.deepEqual(await checked(clients.reporter.from('flights').select('id').eq('id',privateFlight)),[]);
   assert.equal((await clients.admin.rpc('admin_hide_flight',{p_flight_id:networkFlight,p_reason:'Owned moderation test'}).retry(false)).error,null);
   code(await act('reporter',fields(randomUUID(),'flight',networkFlight)),'target_unavailable');code(await act('owner',fields(randomUUID(),'flight',networkFlight)),'reported');
   code(await act('reporter',fields(randomUUID(),'pilot',accounts.disabled.id)),'target_unavailable');code(await act('reporter',fields(randomUUID(),'pilot',accounts.noProfile.id)),'target_unavailable');
  });
  await run('report_intake_ambiguous_confirmation_exact_concurrent_retry_and_stale_actor',async()=>{
   for(const fault of ['lost','malformed']){const input=fields(randomUUID());await mode(fault);try{code(await act('reporter',input),'report_unconfirmed');}finally{await mode('off');}code(await act('reporter',input),'already_reported');assert.equal((await reports('reporter')).filter(r=>r.id===input.report_id).length,1);}
   const input=fields(randomUUID()),results=await Promise.all([rpc('reporter',input),rpc('reporter',input)]);assert.deepEqual(results.map(r=>r.data?.code).sort(),['already_reported','reported']);assert.equal(results[0].data.createdAt,results[1].data.createdAt);
   const stale=fields(randomUUID());await mode('disable-actor:'+accounts.reporter.id);try{code(await act('reporter',stale),'forbidden');assert.deepEqual(await reports('reporter'),[]);}finally{await mode('off');await stack.setMembership(accounts.reporter.id,{role:'member',status:'active'});}
   assert.ok(!(await reports('admin')).some(r=>r.id===stale.report_id));
  });
  await run('report_intake_bounded_reads_and_revoked_admin_reporter_access',async()=>{
   for(let i=0;i<52;i++)assert.equal((await rpc('reporter',fields(randomUUID()))).error,null);
   const founder=await safe(await app.request('/admin/reports',{session:sessions.admin}));assert.match(founder,/Next reports/);const cursor=founder.match(/href="\/admin\/reports\?after=([a-f0-9-]+)"/)?.[1];assert.ok(cursor);assert.match(await safe(await app.request('/admin/reports?after='+cursor,{session:sessions.admin})),/First report page/);assert.match(await safe(await app.request('/admin/reports?after=bad',{session:sessions.admin})),/This report page is unavailable/);
   const first=await list();assert.equal(first.rows.length,50);assert.ok(first.nextCursor);const second=await list('reporter',first.nextCursor);assert.equal(second.status,'authorized');assert.ok(second.rows.length>0);assert.ok(second.rows.every(r=>r.id>first.nextCursor));assert.equal((await list('reporter','invalid')).status,'invalid');
   await mode('list-malformed');try{assert.equal((await list()).status,'unavailable');}finally{await mode('off');}
   await stack.setMembership(accounts.admin.id,{role:'member',status:'active'});assert.deepEqual(await reports('admin'),[]);assert.equal((await list('admin')).rows.length,0);await stack.setMembership(accounts.admin.id,{role:'admin',status:'disabled'});assert.equal((await list('admin')).status,'forbidden');
   await stack.setMembership(accounts.reporter.id,{role:'member',status:'disabled'});assert.deepEqual(await reports('reporter'),[]);assert.equal((await list('reporter')).status,'forbidden');
  });
  await app.scanStatic(text=>{stack.assertNoCredentialLeaks(text);assert.ok(!text.includes('Uncopied private message canary'));});
 }finally{
  await mode('off');for(const account of Object.values(accounts))await stack.removeOwnedReports(account.id);
  if(accounts.owner){await stack.removeOwnedConversations(accounts.owner.id);await stack.removeOwnedFlightModeration(accounts.owner.id);}
  if(flights.length){await checked(privileged.from('flight_requests').delete().in('flight_id',flights));await checked(privileged.from('flight_recipients').delete().in('flight_id',flights));await checked(privileged.from('flights').delete().in('id',flights));}
  for(const account of Object.values(accounts))await stack.removeOwnedProfile(account.id);
  for(const client of Object.values(clients)){client.auth.stopAutoRefresh();client.realtime.disconnect();}
 }
}
