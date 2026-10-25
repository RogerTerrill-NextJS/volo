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
 const safe=async response=>{for(const name of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(response.headers.get(name)??'',/no-store/);const text=(await response.text()).replaceAll('&quot;','"');stack.assertNoCredentialLeaks(text);for(const session of Object.values(sessions))session.assertNoCredentialLeaks(text);for(const a of Object.values(accounts))assert.ok(!text.includes(a.email));assert.ok(!text.includes('private-member-admin-canary'));return text;};
 const act=async(label,target,fields={},settings={})=>safe(await app.disableMember({target_id:target,reason:'Owned admin safety review',confirmation:'disable',...fields},{session:sessions[label],...settings}));
 const overview=async(label,after='')=>JSON.parse(await safe(await app.request('/api/member-overview'+(after?'?after='+after:''),{session:sessions[label]})));
 const audit=async label=>{const r=await clients[label].from('member_admin_audit').select('*').retry(false);assert.equal(r.error,null);return r.data;};
 const membership=label=>checked(admin.from('memberships').select('*').eq('user_id',accounts[label].id).single());
 const checkCode=(text,code)=>assert.ok(text.includes('"code":"'+code+'"'),'Admin outcome '+code);
 const run=(name,fn)=>scenario(name,async()=>{await Promise.all(Object.values(sessions).map(s=>s.refresh()));await fn();});
 try{
  for(const [label,role,status] of [['admin','admin','active'],['peerAdmin','admin','active'],['member','member','active'],['target','member','active'],['second','member','active'],['disabled','admin','disabled'],['absent',null,'active']]){
   accounts[label]=await stack.createAccount({label:'member-admin-'+label.toLowerCase(),role,status});sessions[label]=await signInSession(stack,accounts[label]);clients[label]=createClient(stack.apiUrl,stack.publicKey,options);assert.equal((await clients[label].auth.signInWithPassword({email:accounts[label].email,password:accounts[label].password})).error,null);
   if(role)await checked(admin.from('profiles').insert({user_id:accounts[label].id,display_name:'Owned admin '+label,home_airport:'KPAO',pilot_designation:'licensed'}));
  }
  await run('member_admin_overview_and_action_current_admin_guards',async()=>{
   await sessions.member.setAdmissionMetadata();await checked(admin.from('memberships').update({disabled_reason:'x'.repeat(501)}).eq('user_id',accounts.disabled.id));
   const list=await overview('admin');assert.equal(list.status,'authorized');assert.equal(list.rows.length,6);assert.ok(list.rows.some(r=>r.userId===accounts.target.id&&r.displayName==='Owned admin target'));assert.equal(list.nextCursor,null);assert.ok(list.rows.some(r=>r.userId===accounts.disabled.id&&r.disabledReason.length===500&&r.disabledReasonTruncated));
   assert.equal((await overview('admin','invalid')).status,'invalid');await mode('overview-malformed');try{assert.equal((await overview('admin')).status,'unavailable');}finally{await mode('off');}
   const formHtml=await(await app.request('/admin/member-fixture',{session:sessions.admin})).text(),before=await membership('target');
   for(const label of ['member','disabled','absent']){assert.equal((await overview(label)).status,'forbidden');checkCode(await act(label,accounts.target.id,{}, {formHtml}),'forbidden');assert.deepEqual(await audit(label),[]);}
   checkCode(await act(undefined,accounts.target.id,{}, {formHtml}),'unauthenticated');
   checkCode(await act('admin',accounts.target.id,{}, {origin:null}),'forbidden');
   for(const fields of [{actor_id:accounts.member.id},{role:'admin'},{disabled_at:'2000-01-01'},{confirmation:''},{reason:' '},{reason:'x'.repeat(501)}])checkCode(await act('admin',accounts.target.id,fields),'invalid_input');
   checkCode(await act('admin',accounts.admin.id),'self_disable_not_allowed');checkCode(await act('admin',randomUUID()),'member_unavailable');assert.deepEqual(await membership('target'),before);assert.deepEqual(await audit('admin'),[]);
   await mode('disable-actor:'+accounts.admin.id);try{checkCode(await act('admin',accounts.target.id,{}, {formHtml}),'forbidden');assert.deepEqual(await membership('target'),before);}finally{await mode('off');await stack.setMembership(accounts.admin.id,{role:'admin',status:'active'});}
  });
  await run('member_admin_disable_audit_retained_session_and_no_deletion',async()=>{
   flight=randomUUID();await checked(admin.from('flights').insert({id:flight,owner_id:accounts.target.id,departure_airport:'KPAO',destination_airport:'KSQL',departure_at:new Date(Date.now()+86400000).toISOString(),departure_timezone:'UTC',aircraft_description:'Owned retained C172',pilot_places:1,visibility:'NETWORK'}));
   const profile=await checked(admin.from('profiles').select('*').eq('user_id',accounts.target.id).single()),storedFlight=await checked(admin.from('flights').select('*').eq('id',flight).single());
   const retained=sessions.target.clone();assert.equal((await app.request('/api/subject',{session:retained})).status,200);
   checkCode(await act('admin',accounts.target.id,{}, {transport:'native'}),'disabled');
   const target=await membership('target'),events=await audit('admin');assert.equal(events.length,1);assert.equal(events[0].actor_id,accounts.admin.id);assert.equal(events[0].target_id,accounts.target.id);assert.equal(events[0].action,'member_disabled');assert.equal(events[0].created_at,target.disabled_at);assert.equal(events[0].reason,target.disabled_reason);
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
