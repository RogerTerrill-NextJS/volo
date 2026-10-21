import assert from 'node:assert/strict';
import {verifyRecipientLock} from './recipient-lock-case.mjs';

// Extends the existing owned creation fixture; no second Auth/app harness.
export async function verifyRecipientSelection({stack,app,scenario,accounts,sessions,clients,admin,fields}){
 const checked=async query=>{const r=await query.retry(false);assert.equal(r.error,null,'Owned recipient fixture operation');return r.data;};
 const owner=accounts.member.id,target=accounts.admin.id,other=accounts.noProfile.id;
 const owned=()=>checked(admin.from('flights').select('id,visibility').eq('owner_id',owner));
 const audience=id=>checked(admin.from('flight_recipients').select('user_id').eq('flight_id',id).order('user_id'));
 const visible=(client,id)=>checked(client.from('flights').select('id').eq('id',id));
 async function text(response){
  for(const key of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(response.headers.get(key)??'',/no-store/);
  const body=(await response.text()).replaceAll('&quot;','"');stack.assertNoCredentialLeaks(body);
  for(const session of Object.values(sessions))session.assertNoCredentialLeaks(body);
  for(const account of Object.values(accounts))assert.ok(!body.includes(account.email),'No private account email in recipient result');
  return body;
 }
 const action=async(selected,id,recipient,label='member',extra={},settings={})=>text(await app.recipientAction(selected,{flight_id:id,recipient_id:recipient,...extra},{session:sessions[label],...settings}));
 let flight;
 await scenario('recipient_candidates_reuse_public_directory_projection',async()=>{
  const anonymous=JSON.parse(await text(await app.request('/api/recipient-candidates')));assert.equal(anonymous.status,'unauthenticated');
  const result=JSON.parse(await text(await app.request('/api/recipient-candidates',{session:sessions.member})));
  assert.equal(result.status,'authorized');assert.ok(result.rows.some(row=>row.user_id===target));
  assert.ok(result.rows.every(row=>row.user_id!==owner&&row.user_id!==accounts.disabled.id));
  assert.ok(result.rows.every(row=>Object.keys(row).sort().join(',')==='display_name,home_airport,photoAvailable,user_id'));
 });
 await scenario('recipient_atomic_create_validates_every_identity_and_rolls_back',async()=>{
  for(const ids of [[target,accounts.disabled.id],[owner],[target,target],['private-canary'],[accounts.absent.id]]){
   const before=await owned();const body=await text(await app.createFlight({...fields,visibility:'PRIVATE',recipient_ids:JSON.stringify(ids)},{session:sessions.member}));
   assert.ok(body.includes('"code":"invalid_input"'));assert.deepEqual(await owned(),before,'Invalid recipient batch leaves no created flight');
  }
  const before=await owned();const body=await text(await app.createFlight({...fields,visibility:'PRIVATE',recipient_ids:JSON.stringify([target,other])},{session:sessions.member}));
  assert.ok(body.includes('"code":"created"'));assert.ok(body.includes('"recipientCount":2'));
  const added=(await owned()).filter(row=>!before.some(old=>old.id===row.id));assert.equal(added.length,1);flight=added[0].id;
  assert.equal(added[0].visibility,'PRIVATE');assert.deepEqual((await audience(flight)).map(row=>row.user_id).sort(),[target,other].sort());
  assert.equal((await visible(clients.admin,flight)).length,1);assert.equal((await visible(clients.noProfile,flight)).length,1);
  assert.equal((await visible(clients.adminNoProfile,flight)).length,0);
  const invalidNetwork=await text(await app.createFlight({...fields,visibility:'NETWORK',recipient_ids:JSON.stringify([target])},{session:sessions.member}));assert.ok(invalidNetwork.includes('"code":"invalid_input"'));
  const page=await text(await app.createFlight({...fields,visibility:'PRIVATE',recipient_ids:JSON.stringify([target])},{session:sessions.member,page:true,transport:'native'}));
  assert.ok(page.includes('Private flight published to your selected pilots.'));assert.ok(!page.includes('Only you can see it;'));
 });
 await scenario('recipient_actions_guard_owner_identity_origin_and_exact_fields',async()=>{
  const before=await audience(flight);
  for(const label of ['admin','adminNoProfile','disabled','absent'])assert.ok((await action(false,flight,target,label)).includes('"code":"forbidden"'));
  assert.ok((await action(false,flight,target,null)).includes('"code":"unauthenticated"'));
  assert.ok((await action(false,flight,target,'member',{owner_id:owner})).includes('"code":"invalid_input"'));
  assert.ok((await action(false,flight,target,'member',{}, {origin:null})).includes('"code":"forbidden"'));
  assert.deepEqual(await audience(flight),before);
  const network=(await owned()).find(row=>row.visibility==='NETWORK');assert.ok(network);
  assert.ok((await action(true,network.id,target)).includes('"code":"invalid_input"'));
  assert.equal((await clients.admin.rpc('change_flight_recipient',{p_flight_id:flight,p_recipient_id:accounts.adminNoProfile.id,p_selected:true}).retry(false)).error?.code,'42501');
  assert.notEqual((await clients.member.from('flight_recipients').delete().eq('flight_id',flight)).error,null);
 });
 await scenario('recipient_remove_readd_and_disabled_sessions_keep_live_rls',async()=>{
  for(const transport of ['native','fetched'])assert.ok((await action(false,flight,target,'member',{}, {transport})).includes('"code":"updated"'));
  assert.equal((await visible(clients.admin,flight)).length,0);
  assert.equal((await visible(clients.noProfile,flight)).length,1,'Unrelated selected pilot is retained');
  assert.ok((await action(true,flight,target)).includes('"code":"updated"'));assert.ok((await action(true,flight,target)).includes('"code":"updated"'));
  assert.equal((await audience(flight)).length,2);assert.equal((await visible(clients.admin,flight)).length,1);
  await stack.setMembership(target,{role:'admin',status:'disabled'});
  try{
   assert.equal((await visible(clients.admin,flight)).length,0);
   assert.ok((await action(true,flight,target)).includes('"code":"invalid_input"'));
   assert.ok((await action(false,flight,target)).includes('"code":"updated"'),'Owner can revoke a disabled target');
  }finally{await stack.setMembership(target,{role:'admin',status:'active'});}
  assert.equal((await visible(clients.admin,flight)).length,0,'Re-enabling membership does not recreate removed selection');
  await stack.setMembership(owner,{role:'member',status:'disabled'});
  try{
   const denied=await clients.member.rpc('change_flight_recipient',{p_flight_id:flight,p_recipient_id:other,p_selected:false}).retry(false);assert.equal(denied.error?.code,'42501');
  }finally{await stack.setMembership(owner,{role:'member',status:'active'});}
 });
 await scenario('recipient_atomic_create_rechecks_stale_candidate_membership',async()=>{
  const before=await owned();assert.equal((await app.request('/api/flight-create-control',{method:'POST',body:'disable:'+target})).status,200);
  try{
   const body=await text(await app.createFlight({...fields,visibility:'PRIVATE',recipient_ids:JSON.stringify([target])},{session:sessions.member}));
   assert.ok(body.includes('"code":"invalid_input"'));assert.deepEqual(await owned(),before);
  }finally{await app.request('/api/flight-create-control',{method:'POST',body:'off'});await stack.setMembership(target,{role:'admin',status:'active'});}
 });
 await scenario('recipient_flight_lock_serializes_add_then_remove',async()=>{
  await verifyRecipientLock({stack,flightId:flight,ownerId:owner,recipientId:target});
  assert.ok(!(await audience(flight)).some(row=>row.user_id===target));
 });
}
