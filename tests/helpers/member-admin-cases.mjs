import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {signInSession} from './real-auth-session.mjs';
import {validateLocalApiUrl} from './local-auth-stack.mjs';

export async function verifyMemberAdmin({stack,app,scenario}){
 validateLocalApiUrl(stack.apiUrl,Number(new URL(stack.apiUrl).port));
 const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}},admin=createClient(stack.apiUrl,stack.serverSecret,options),accounts={},sessions={},clients={};let flight;
 const checked=async q=>{const r=await q.retry(false);assert.equal(r.error,null,'Owned admin fixture operation');return r.data;};
 const mode=async value=>assert.equal((await app.request('/api/member-admin-control',{method:'POST',body:value})).status,200);
 const safe=async response=>{for(const name of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(response.headers.get(name)??'',/no-store/);const text=await response.text();stack.assertNoCredentialLeaks(text);for(const session of Object.values(sessions))session.assertNoCredentialLeaks(text);for(const a of Object.values(accounts))assert.ok(!text.includes(a.email));assert.ok(!text.includes('private-member-admin-canary'));return text;};
 const act=async(label,target,fields={},settings={})=>safe(await app.disableMember({target_id:target,reason:'Owned admin safety review',confirmation:'disable',...fields},{session:sessions[label],...settings}));
 const overview=async(label,after='')=>JSON.parse(await safe(await app.request('/api/member-overview'+(after?'?after='+after:''),{session:sessions[label]})));
 const audit=async label=>{const r=await clients[label].from('member_admin_audit').select('*').retry(false);assert.equal(r.error,null);return r.data;};
 const membership=label=>checked(admin.from('memberships').select('*').eq('user_id',accounts[label].id).single());
 const checkCode=(text,code)=>assert.ok(text.replaceAll('&quot;','"').includes('"code":"'+code+'"'),'Admin outcome '+code);
 const run=(name,fn)=>scenario(name,async()=>{await Promise.all(Object.values(sessions).map(s=>s.refresh()));await fn();});
 try{
  for(const [label,role,status] of [['admin','admin','active'],['peerAdmin','admin','active'],['member','member','active'],['target','member','active'],['second','member','active'],['disabled','admin','disabled'],['absent',null,'active'],['uiNative','member','active'],['uiFetched','member','active']]){
   accounts[label]=await stack.createAccount({label:'member-admin-'+label.toLowerCase(),role,status});sessions[label]=await signInSession(stack,accounts[label]);clients[label]=createClient(stack.apiUrl,stack.publicKey,options);assert.equal((await clients[label].auth.signInWithPassword({email:accounts[label].email,password:accounts[label].password})).error,null);
   if(role)await checked(admin.from('profiles').insert({user_id:accounts[label].id,display_name:'Owned admin '+label,home_airport:'KPAO',pilot_designation:'licensed'}));
  }
  await run('member_admin_overview_and_action_current_admin_guards',async()=>{
   await sessions.member.setAdmissionMetadata();await checked(admin.from('memberships').update({disabled_reason:'x'.repeat(501)}).eq('user_id',accounts.disabled.id));
   const list=await overview('admin');assert.equal(list.status,'authorized');assert.equal(list.rows.length,8);assert.ok(list.rows.some(r=>r.userId===accounts.target.id&&r.displayName==='Owned admin target'));assert.equal(list.nextCursor,null);assert.ok(list.rows.some(r=>r.userId===accounts.disabled.id&&r.disabledReason.length===500&&r.disabledReasonTruncated));
   assert.equal((await overview('admin','invalid')).status,'invalid');await mode('overview-malformed');try{assert.equal((await overview('admin')).status,'unavailable');}finally{await mode('off');}
   const formHtml=await(await app.request('/admin/member-fixture',{session:sessions.admin})).text(),before=await membership('target');
   for(const label of ['member','disabled','absent']){assert.equal((await overview(label)).status,'forbidden');checkCode(await act(label,accounts.target.id,{}, {formHtml}),'forbidden');assert.deepEqual(await audit(label),[]);}
   checkCode(await act(undefined,accounts.target.id,{}, {formHtml}),'unauthenticated');
   checkCode(await act('admin',accounts.target.id,{}, {origin:null}),'forbidden');
   for(const fields of [{actor_id:accounts.member.id},{role:'admin'},{disabled_at:'2000-01-01'},{confirmation:''},{reason:' '},{reason:'x'.repeat(501)}])checkCode(await act('admin',accounts.target.id,fields),'invalid_input');
   checkCode(await act('admin',accounts.admin.id),'self_disable_not_allowed');checkCode(await act('admin',randomUUID()),'member_unavailable');assert.deepEqual(await membership('target'),before);assert.deepEqual(await audit('admin'),[]);
   await mode('disable-actor:'+accounts.admin.id);try{checkCode(await act('admin',accounts.target.id,{}, {formHtml}),'forbidden');assert.deepEqual(await membership('target'),before);}finally{await mode('off');await stack.setMembership(accounts.admin.id,{role:'admin',status:'active'});}
  });
  const memberPage=async(label='admin',after)=>safe(await app.request('/admin/members'+(after?'?after='+after:''),{session:sessions[label]}));
  const card=(html,id)=>html.match(new RegExp('<article\\b[^>]*id="member-'+id+'"[^>]*>([\\s\\S]*?)</article>'))?.[1]??assert.fail('Owned member card missing');
  await run('member_admin_page_native_fetched_confirmation_and_safe_controls',async()=>{
   await checked(admin.from('profiles').update({display_name:'<script>Owned member text</script>'}).eq('user_id',accounts.uiNative.id));
   const html=await memberPage();assert.match(html,/Members/);assert.ok(html.includes('href="/admin/members"'));assert.ok(html.includes('&lt;script&gt;Owned member text&lt;/script&gt;'));assert.ok(!html.includes('<script>Owned member text</script>'));
   assert.ok(!card(html,accounts.admin.id).includes('name="target_id"'));assert.ok(!card(html,accounts.disabled.id).includes('name="target_id"'));assert.match(card(html,accounts.disabled.id),/Reason excerpt shown/);
   for(const label of ['member','disabled','absent']){const denied=await memberPage(label);assert.ok(!denied.includes('Owned admin target')&&!denied.includes('name="target_id"'));}
   const target=accounts.uiNative.id,result=await safe(await app.memberPageAction(target,{}, {session:sessions.admin,transport:'native'}));assert.match(card(result,target),/Member disabled/);assert.ok(card(result,accounts.uiFetched.id).includes('name="reason"'),'Native state applies only to its target card');assert.ok(!card(result,target).includes('name="reason"'));
   const fetched=await safe(await app.memberPageAction(accounts.uiFetched.id,{}, {session:sessions.admin}));assert.ok(fetched.includes('"status":"disabled"'));assert.ok(!card(await memberPage(),accounts.uiFetched.id).includes('name="target_id"'));
  });
  await run('member_admin_page_uncertain_recovery_paging_and_stale_actor',async()=>{
   for(const fault of ['lost','malformed']){
    await stack.setMembership(accounts.uiNative.id,{role:'member',status:'active'});const html=await memberPage();await mode(fault);
    try{const result=await safe(await app.memberPageAction(accounts.uiNative.id,{}, {session:sessions.admin,transport:'native',formHtml:html}));assert.match(card(result,accounts.uiNative.id),/Check member status/);assert.ok(!card(result,accounts.uiNative.id).includes('name="reason"'));}finally{await mode('off');}
    assert.ok(!card(await memberPage(),accounts.uiNative.id).includes('name="target_id"'));
   }
   const extras=[];for(let i=0;i<52;i++){const label='page'+i;accounts[label]=await stack.createAccount({label:'member-page-'+i,role:'member'});extras.push(accounts[label].id);}
   const first=await overview('admin');assert.equal(first.rows.length,50);assert.ok(first.nextCursor);assert.ok((await memberPage()).includes('href="/admin/members?after='+first.nextCursor+'"'));
   const second=await overview('admin',first.nextCursor),target=second.rows.find(r=>extras.includes(r.userId)).userId,html=await memberPage('admin',first.nextCursor);assert.ok(html.includes('First member page'));assert.match(await memberPage('admin','invalid'),/This member page is unavailable/);assert.match(await memberPage('admin','ffffffff-ffff-ffff-ffff-ffffffffffff'),/No more members/);
   await mode('lost');try{const result=await safe(await app.memberPageAction(target,{}, {session:sessions.admin,transport:'native',after:first.nextCursor,formHtml:html}));const row=card(result,target);assert.ok(row.includes('name="after" value="'+first.nextCursor+'"'));assert.match(row,/Check member status/);}finally{await mode('off');}
   await mode('overview-malformed');try{const unavailable=await memberPage();assert.match(unavailable,/Members temporarily unavailable/);assert.ok(!unavailable.includes('name="target_id"'));}finally{await mode('off');}
   await stack.setMembership(accounts.uiFetched.id,{role:'member',status:'active'});const stale=await memberPage();await mode('disable-actor:'+accounts.admin.id);
   try{const result=await safe(await app.memberPageAction(accounts.uiFetched.id,{}, {session:sessions.admin,formHtml:stale}));assert.ok(!result.includes('"status":"disabled"'));assert.equal((await membership('uiFetched')).status,'active');}finally{await mode('off');await stack.setMembership(accounts.admin.id,{role:'admin',status:'active'});}
  });
  await run('member_admin_disable_audit_retained_session_and_no_deletion',async()=>{
   flight=randomUUID();await checked(admin.from('flights').insert({id:flight,owner_id:accounts.target.id,departure_airport:'KPAO',destination_airport:'KSQL',departure_at:new Date(Date.now()+86400000).toISOString(),departure_timezone:'UTC',aircraft_description:'Owned retained C172',pilot_places:1,visibility:'NETWORK'}));
   const profile=await checked(admin.from('profiles').select('*').eq('user_id',accounts.target.id).single()),storedFlight=await checked(admin.from('flights').select('*').eq('id',flight).single());
   const retained=sessions.target.clone();assert.equal((await app.request('/api/subject',{session:retained})).status,200);
   checkCode(await act('admin',accounts.target.id,{}, {transport:'native'}),'disabled');
   const target=await membership('target'),events=await audit('admin'),event=events.find(e=>e.target_id===accounts.target.id);assert.equal(event.actor_id,accounts.admin.id);assert.equal(event.target_id,accounts.target.id);assert.equal(event.action,'member_disabled');assert.equal(event.created_at,target.disabled_at);assert.equal(event.reason,target.disabled_reason);
   assert.equal((await app.request('/api/subject',{session:retained})).status,403);assert.deepEqual(await checked(clients.target.from('profiles').select('*')),[]);assert.deepEqual(await checked(clients.target.from('flights').select('*')),[]);assert.equal((await clients.target.auth.getUser()).error,null,'Disable retains Auth identity');
   assert.deepEqual(await checked(admin.from('profiles').select('*').eq('user_id',accounts.target.id).single()),profile);assert.deepEqual(await checked(admin.from('flights').select('*').eq('id',flight).single()),storedFlight);
   checkCode(await act('admin',accounts.target.id,{reason:'Different retry'}),'already_disabled');assert.deepEqual(await membership('target'),target);assert.deepEqual(await audit('admin'),events);
   const result=await clients.member.rpc('admin_disable_member',{p_target_id:accounts.second.id,p_reason:'Forged metadata'}).retry(false);assert.equal(result.error?.code,'42501');
  });
  await run('member_admin_ambiguous_responses_and_concurrent_cross_disable',async()=>{
   for(const fault of ['lost','malformed']){
    await stack.setMembership(accounts.second.id,{role:'member',status:'active'});const before=(await audit('admin')).length;await mode(fault);try{checkCode(await act('admin',accounts.second.id),'disable_unconfirmed');}finally{await mode('off');}
    checkCode(await act('admin',accounts.second.id),'already_disabled');assert.equal((await audit('admin')).length,before+1);
   }
   await stack.setMembership(accounts.second.id,{role:'member',status:'active'});const count=(await audit('admin')).length;
   const repeated=await Promise.all(['admin','peerAdmin'].map(label=>clients[label].rpc('admin_disable_member',{p_target_id:accounts.second.id,p_reason:'Concurrent disable'}).retry(false)));
   assert.deepEqual(repeated.map(r=>r.data?.code).sort(),['already_disabled','disabled']);assert.equal(repeated[0].data.disabledAt,repeated[1].data.disabledAt);assert.equal((await audit('admin')).length,count+1);
   const results=await Promise.all([clients.admin.rpc('admin_disable_member',{p_target_id:accounts.peerAdmin.id,p_reason:'Cross disable A'}).retry(false),clients.peerAdmin.rpc('admin_disable_member',{p_target_id:accounts.admin.id,p_reason:'Cross disable B'}).retry(false)]);
   assert.equal(results.filter(r=>r.data?.code==='disabled').length,1);assert.equal(results.filter(r=>r.error?.code==='42501').length,1);const a=await membership('admin'),b=await membership('peerAdmin');assert.equal([a,b].filter(r=>r.status==='active').length,1);
   const revoked=a.status==='disabled'?'admin':'peerAdmin';assert.equal((await overview(revoked)).status,'forbidden');
  });
 }finally{
  await mode('off');if(flight)await checked(admin.from('flights').delete().eq('id',flight));for(const account of Object.values(accounts))await stack.removeOwnedProfile(account.id);for(const client of Object.values(clients)){client.auth.stopAutoRefresh();client.realtime.disconnect();}
 }
}
