import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import sharp from 'sharp';
import {createClient} from '@supabase/supabase-js';
import {runDeletionStep} from '../../lib/deletion/runner.mjs';
import {validateLocalApiUrl,localProcessEnvironment} from './local-auth-stack.mjs';
import {signInSession} from './real-auth-session.mjs';
const exec=promisify(execFile);
export async function verifyAccountDeletion({stack,app,scenario}){
 const {cleanupProfilePhotos}=await import('../../lib/profiles/photo-cleanup.ts');
 validateLocalApiUrl(stack.apiUrl,Number(new URL(stack.apiUrl).port));
 const container='supabase_db_'+stack.projectId;
 const label=await exec('docker',['inspect','--format','{{ index .Config.Labels "com.supabase.cli.project" }}',container],{env:localProcessEnvironment()});assert.equal(label.stdout.trim(),stack.projectId);
 const sql=async statement=>exec('docker',['exec',container,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-qAt','-c',statement],{env:localProcessEnvironment(),maxBuffer:1024*1024});
 const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>{assert.equal(new URL(typeof input==='string'?input:input.url??input).origin,stack.apiUrl);return fetch(input,{...init,redirect:'error',signal:AbortSignal.timeout(15000)});}}};
 const service=createClient(stack.apiUrl,stack.serverSecret,options),owned=[],clients={},flights=[],requests=[],threads=[],assets=[];
 const checked=async query=>{const r=await query.retry(false);assert.equal(r.error,null,'Owned deletion fixture operation');return r.data;};
 const previous=[process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,process.env.SUPABASE_SECRET_KEY];
 process.env.NEXT_PUBLIC_SUPABASE_URL=stack.apiUrl;process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=stack.publicKey;process.env.SUPABASE_SECRET_KEY=stack.serverSecret;
 let target,admin,other,request,session,targetSession;let stage='accounts';
 try{
  for(const [name,role] of [['admin','admin'],['target','member'],['other','member'],['outsider','admin']]){
   const a=await stack.createAccount({label:'deletion-'+name,role});owned.push(a);if(name==='admin')admin=a;if(name==='target')target=a;if(name==='other')other=a;
   const c=clients[name]=createClient(stack.apiUrl,stack.publicKey,options);assert.equal((await c.auth.signInWithPassword({email:a.email,password:a.password})).error,null);
   await checked(service.from('profiles').insert({user_id:a.id,display_name:'Owned deletion '+name,home_airport:'KPAO',pilot_designation:'licensed'}));
  }
  assert.equal((await clients.target.auth.updateUser({data:{display_name:'Private deletion metadata'}})).error,null);
  session=await signInSession(stack,other);targetSession=await signInSession(stack,target);
  stage='flight';const flight=randomUUID();flights.push(flight);await checked(service.from('flights').insert({id:flight,owner_id:target.id,departure_airport:'KPAO',destination_airport:'KSQL',departure_at:new Date(Date.now()+86400000).toISOString(),departure_timezone:'UTC',aircraft_description:'Owned deletion C172',pilot_places:1,visibility:'NETWORK'}));
  stage='interest';const interest=await checked(clients.other.rpc('submit_flight_interest',{p_flight_id:flight,p_introductory_note:'Keep shared request'}));requests.push(interest.requestId);
  stage='acceptance';await checked(clients.target.rpc('decide_flight_request',{p_flight_id:flight,p_request_id:interest.requestId,p_decision:'accepted'}));
  stage='conversation';const opened=await checked(clients.target.rpc('get_or_create_flight_conversation',{p_request_id:interest.requestId}));const thread=typeof opened==='string'?opened:opened.conversationId;assert.ok(thread);threads.push(thread);
  stage='message';await checked(clients.target.rpc('send_conversation_message',{p_conversation_id:thread,p_message_id:randomUUID(),p_body:'Retain the shared history'}));
  const png=await sharp({create:{width:8,height:8,channels:3,background:'white'}}).png().toBuffer();
  const webp=await sharp(png).webp().toBuffer();
  async function uploadReserved(current=false){
   stage='reservation';const r=await checked(clients.target.rpc('reserve_profile_photo'));
   r.final_path=target.id+'/'+r.id+'.webp';
   assets.push(['profile-photo-uploads',r.source_path],['profile-photos',r.final_path]);
   stage='source-upload';assert.equal((await clients.target.storage.from('profile-photo-uploads').upload(r.source_path,png,{contentType:'image/png'})).error,null);
   stage='processing';await checked(clients.target.rpc('begin_profile_photo_finalize',{reservation_id:r.id}));
   stage='final-upload';assert.equal((await service.storage.from('profile-photos').upload(r.final_path,webp,{contentType:'image/webp'})).error,null);
   if(current){await checked(service.rpc('mark_profile_photo_ready',{reservation_id:r.id}));await checked(clients.target.rpc('attach_profile_photo',{reservation_id:r.id}));}
   return r;
  }
  await uploadReserved(true);
  const orphan=await uploadReserved();await checked(service.rpc('abandon_profile_photo',{reservation_id:orphan.id}));
  // Create realistic orphan bytes only after a legitimate Storage commit, without weakening its trigger.
  await sql(`delete from public.profile_photo_objects where id='${orphan.id}' and owner_id='${target.id}';`);
  const pending=await checked(clients.target.rpc('reserve_profile_photo'));assets.push(['profile-photo-uploads',pending.source_path]);
  assert.equal((await clients.target.storage.from('profile-photo-uploads').upload(pending.source_path,png,{contentType:'image/png'})).error,null);
  request=randomUUID();const cli=async(extra=[])=>{
   const token=(await clients.admin.auth.getSession()).data.session.access_token;
   const r=await exec(process.execPath,['--conditions=react-server',path.resolve(import.meta.dirname,'../../scripts/process-account-deletion.mjs'),'--request',request,...extra],{env:{...localProcessEnvironment(),NEXT_PUBLIC_SUPABASE_URL:stack.apiUrl,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:stack.publicKey,SUPABASE_SECRET_KEY:stack.serverSecret,VOLO_DELETION_ADMIN_ACCESS_TOKEN:token},maxBuffer:1024*1024});
   assert.ok(!r.stdout.includes(token));stack.assertNoCredentialLeaks(r.stdout+r.stderr);return JSON.parse(r.stdout.trim());
  };const rpc=async(name,args)=>checked(clients.admin.rpc(name,args));
  const ports={status:id=>rpc('admin_account_deletion_status',{p_request_id:id}),prepare:id=>rpc('admin_prepare_account_deletion',{p_request_id:id}),cleanup:id=>cleanupProfilePhotos(20,{ownerId:id}),removeObjects:async(bucket,paths)=>{const r=await service.storage.from(bucket).remove(paths);assert.equal(r.error,null);},finishPhotos:id=>rpc('admin_finish_deletion_photos',{p_request_id:id}),authUser:async id=>{const r=await service.auth.admin.getUserById(id);assert.equal(r.error,null);return r.data.user;},deleteAuth:async id=>{const r=await service.auth.admin.deleteUser(id,true);assert.equal(r.error,null);},complete:id=>rpc('admin_complete_account_deletion',{p_request_id:id})};
  await scenario('deletion_default_off_and_verified_admin_fence',async()=>{
   const preview=await rpc('admin_account_deletion_preview',{p_subject_id:target.id});assert.equal(preview.subjectId,target.id);assert.equal(preview.ownedOpenFlights,1);assert.equal(preview.conversations,1);assert.equal(preview.retentionDays,60);assert.equal(preview.policyReady,false);
   const args={p_request_id:request,p_subject_id:target.id,p_reference:'Owned verified request',p_confirmation:target.id};
   const previewCli=await cli(['--subject',target.id,'--confirm',target.id,'--reference','Owned verified request']);assert.equal(previewCli.impact.policyReady,false);assert.equal((await stack.readMembership(target.id)).status,'active');
   assert.ok((await clients.admin.rpc('admin_begin_account_deletion',args)).error);
   await sql("update deletion_private.policy set retention_verified=true,evidence_reference='Owned local fixture only';");
   assert.ok((await clients.other.rpc('admin_begin_account_deletion',args)).error);
   const [begun]=await Promise.all([cli(['--subject',target.id,'--confirm',target.id,'--reference','Owned verified request','--execute']),clients.target.rpc('send_conversation_message',{p_conversation_id:thread,p_message_id:randomUUID(),p_body:'A racing message before the fence'})]);
   assert.equal(begun.code,'started');
   assert.ok((await clients.target.rpc('send_conversation_message',{p_conversation_id:thread,p_message_id:randomUUID(),p_body:'Cannot send after fence'})).error);
   assert.equal((await stack.readMembership(target.id)).status,'disabled');
   assert.ok((await clients.target.rpc('submit_flight_interest',{p_flight_id:flight,p_introductory_note:'Denied'})).error);
  });
  await scenario('deletion_storage_parent_drain_and_orphan_cleanup',async()=>{
   assert.equal((await runDeletionStep(request,ports)).code,'photos');
   assert.equal((await runDeletionStep(request,ports)).code,'waiting_for_photo_drain');
   assert.ok((await checked(service.from('profiles').select('user_id').eq('user_id',target.id))).length);
   // Backdate only this owned job; no production waits or global clock replacement.
   await sql(`update deletion_private.jobs set photo_after=clock_timestamp()-interval '1 second' where id='${request}';`);
   let status;
   for(let i=0;i<3;i++){await runDeletionStep(request,ports);status=await ports.status(request);if(status.phase==='auth')break;}
   assert.equal(status.phase,'auth');assert.equal(status.photoPending,0);
   assert.equal((await checked(service.from('profiles').select('user_id').eq('user_id',target.id))).length,0);
   assert.equal((await service.storage.from('profile-photos').list(target.id)).data.length,0);
   assert.equal((await service.storage.from('profile-photo-uploads').list(target.id)).data.length,0);
  });
  await scenario('deletion_real_auth_removal_and_shared_history_privacy',async()=>{
   assert.equal((await cli(['--execute'])).code,'retention_pending');
   assert.ok((await createClient(stack.apiUrl,stack.publicKey,options).auth.signInWithPassword({email:target.email,password:target.password})).error);
   const removed=(await service.auth.admin.getUserById(target.id)).data.user;assert.ok(removed.deleted_at);assert.deepEqual(removed.user_metadata,{});assert.ok(!JSON.stringify(removed).includes(target.email));
   const denied=await app.request('/api/subject',{session:targetSession});assert.ok([401,403].includes(denied.status));
   const raw=await clients.target.from('messages').select('*').eq('conversation_id',thread);assert.ok(raw.error||raw.data.length===0);
   assert.ok((await checked(clients.other.from('messages').select('body').eq('conversation_id',thread))).some(row=>row.body==='Retain the shared history'));
   assert.equal((await checked(clients.outsider.from('messages').select('body').eq('conversation_id',thread))).length,0);
   assert.equal(await checked(clients.other.rpc('conversation_has_deleted_pilot',{p_conversation_id:thread})),true);
   const html=await(await app.request('/messages/'+thread,{session})).text();assert.ok(html.includes('Deleted pilot'));assert.ok(html.includes('Retain the shared history'));assert.ok(!html.includes('Owned deletion target'));
   const connection=await(await app.request('/dashboard/connections/'+interest.requestId,{session})).text();assert.ok(connection.includes('Deleted pilot'));
   const list=await(await app.request('/messages',{session})).text();assert.ok(list.includes('Deleted pilot'));
  });
  await scenario('deletion_retention_clock_and_admin_revocation',async()=>{
   assert.equal((await runDeletionStep(request,ports)).code,'retention_pending');
   await stack.setMembership(admin.id,{role:'member',status:'active'});assert.ok((await clients.admin.rpc('admin_account_deletion_status',{p_request_id:request})).error);await stack.setMembership(admin.id,{role:'admin',status:'active'});
   await sql(`update deletion_private.jobs set verified_at=statement_timestamp()-interval '1440 hours',purge_due_at=statement_timestamp() where id='${request}';select deletion_private.purge_due();`);
   assert.equal((await ports.status(request)).phase,'purged');
   const payload=await sql(`select (reference is null and subject_email is null and verified_by is null)::text from deletion_private.jobs where id='${request}';`);assert.equal(payload.stdout.trim(),'true');
  });
 }catch(error){error.operation??='deletion-'+stage;error.fixtureDiagnostic={stage,status:Number(error.actual?.statusCode??error.actual?.status??0),kind:error.actual?.name??error.name};throw error;}finally{
  await sql("update deletion_private.policy set retention_verified=false,evidence_reference='';");
  for(const [bucket,path] of assets)await service.storage.from(bucket).remove([path]);
  if(target){for(const bucket of ['profile-photo-uploads','profile-photos']){const list=await service.storage.from(bucket).list(target.id);const paths=(list.data??[]).filter(x=>x.id).map(x=>target.id+'/'+x.name);if(paths.length)await service.storage.from(bucket).remove(paths);}}
  for(const a of owned)await stack.removeOwnedConversations(a.id);
  if(flights.length){await checked(service.from('flight_requests').delete().in('flight_id',flights));await checked(service.from('flights').delete().in('id',flights));}
  if(target)await sql(`delete from public.profile_photo_objects where owner_id='${target.id}';delete from deletion_private.jobs where subject_id='${target.id}';`);
  for(const a of owned)await stack.removeOwnedProfile(a.id);
  for(const [i,name] of ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY'].entries()){if(previous[i]===undefined)delete process.env[name];else process.env[name]=previous[i];}
 }
}
