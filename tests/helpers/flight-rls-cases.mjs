import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {validateLocalApiUrl} from './local-auth-stack.mjs';

// Cases for the existing owned Auth runner, not another stack/app harness.
export async function verifyFlightRls({stack,scenario}) {
  validateLocalApiUrl(stack.apiUrl,Number(new URL(stack.apiUrl).port));
  const localFetch=(input,init)=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    assert.equal(url.origin,stack.apiUrl,'Flight fixtures must stay on the owned local API');
    return fetch(input,{...init,redirect:'error',signal:init?.signal??AbortSignal.timeout(10000)});
  };
  const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:localFetch}};
  const admin=createClient(stack.apiUrl,stack.serverSecret,options);
  const accounts={},sessions={},clients=[],secrets=new Set();
  const ids={network:randomUUID(),private:randomUUID(),otherPrivate:randomUUID()};
  const canary='private-flight-'+randomUUID();
  async function checked(query,message){const result=await query.retry(false);assert.equal(result.error,null,message);return result.data;}
  async function signIn(label){
    const client=createClient(stack.apiUrl,stack.publicKey,options);clients.push(client);
    const {data,error}=await client.auth.signInWithPassword({email:accounts[label].email,password:accounts[label].password});
    assert.equal(error,null,'Owned flight fixture sign-in succeeds');assert.equal(data.user?.id,accounts[label].id);
    secrets.add(data.session.access_token);secrets.add(data.session.refresh_token);
    sessions[label]={token:data.session.access_token,expiresAt:data.session.expires_at};return client;
  }
  async function request(label,route,{method='GET',body,profile='public',prefer='count=exact,return=representation'}={}){
    const session=sessions[label];
    if(session)assert.ok(session.expiresAt*1000>Date.now(),'Retained fixture JWT must still be unexpired');
    const response=await localFetch(stack.apiUrl+'/rest/v1'+route,{method,
      headers:{apikey:stack.publicKey,...(session?{Authorization:'Bearer '+session.token}:{}),
        'content-type':'application/json','Accept-Profile':profile,'Content-Profile':profile,Prefer:prefer},
      body:body===undefined?undefined:JSON.stringify(body)});
    const text=await response.text();stack.assertNoCredentialLeaks(text);
    for(const secret of secrets)assert.ok(!text.includes(secret),'Flight data API must not return fixture credentials');
    return {status:response.status,rows:text?JSON.parse(text):null,range:response.headers.get('content-range')};
  }
  function visible(result,expected,message){
    assert.equal(result.status,200,message);assert.deepEqual(result.rows.map(row=>row.id).sort(),[...expected].sort(),message);
    assert.ok(result.range?.endsWith('/'+expected.length),'Exact count includes only authorized flights');
  }
  async function snapshot(){return {
    flights:await checked(admin.from('flights').select('*').in('id',Object.values(ids)).order('id'),'Read owned flight snapshot'),
    recipients:await checked(admin.from('flight_recipients').select('*').in('flight_id',Object.values(ids)).order('flight_id').order('user_id'),'Read owned recipient snapshot'),
    memberships:await checked(admin.from('memberships').select('*').in('user_id',Object.values(accounts).map(a=>a.id)).order('user_id'),'Read owned access snapshot'),
  };}
  try{
    for(const [label,role,status] of [['owner','member','active'],['recipient','member','active'],['other','member','active'],['admin','admin','active'],['disabled','member','disabled'],['absent',null,'active'],['peer','member','active']]){
      accounts[label]=await stack.createAccount({label:'flight-'+label,role,status});secrets.add(accounts[label].password);
      const client=await signIn(label);
      if(['other','disabled','absent'].includes(label)){
        const update=await client.auth.updateUser({data:{role:'admin',status:'active',membership_status:'active'}});
        assert.equal(update.error,null,'Member-controlled metadata spoof fixture succeeds');
        await signIn(label); // Get a genuine Auth-signed JWT containing the spoofed user metadata.
      }
    }
    const flight=(id,owner,visibility,notes)=>({id,owner_id:accounts[owner].id,
      departure_airport:'KPAO',destination_airport:'KPAO',departure_at:'2030-06-01T18:00:00Z',
      departure_timezone:'America/Los_Angeles',aircraft_description:'Owned C172 fixture',pilot_places:2,visibility,notes});
    await checked(admin.from('flights').insert([
      flight(ids.network,'owner','NETWORK',null),flight(ids.private,'owner','PRIVATE',canary),
      flight(ids.otherPrivate,'other','PRIVATE','other-'+canary),
    ]),'Create owned flight fixtures');
    await checked(admin.from('flight_recipients').insert([
      {flight_id:ids.private,user_id:accounts.recipient.id},{flight_id:ids.private,user_id:accounts.peer.id},
      {flight_id:ids.otherPrivate,user_id:accounts.peer.id},
    ]),'Create owned recipient fixtures');

    await scenario('flight_rls_network_private_direct_reads',async()=>{
      const expected={owner:[ids.network,ids.private],recipient:[ids.network,ids.private],
        other:[ids.network,ids.otherPrivate],admin:[ids.network],peer:Object.values(ids),disabled:[],absent:[]};
      for(const [label,allowed] of Object.entries(expected)){
        visible(await request(label,'/flights?select=id,owner_id,visibility,notes&order=id'),allowed,label+' direct visibility');
        const target=await request(label,'/flights?id=eq.'+ids.private+'&select=id,notes');
        visible(target,allowed.includes(ids.private)?[ids.private]:[],label+' PRIVATE id lookup');
        if(!allowed.includes(ids.private))assert.ok(!JSON.stringify(target.rows).includes(canary),'Private notes remain hidden');
      }
      for(const table of ['flights','flight_recipients']){
        const result=await request(null,'/'+table+'?select=*');
        assert.equal(result.status,401,'Anonymous direct reads rejected');assert.equal(result.rows.code,'42501');
      }
    });
    await scenario('flight_rls_audience_counts_and_embedded_relations',async()=>{
      const owner=await request('owner','/flight_recipients?flight_id=eq.'+ids.private+'&select=user_id');
      assert.equal(owner.status,200);assert.deepEqual(owner.rows.map(r=>r.user_id).sort(),[accounts.recipient.id,accounts.peer.id].sort());assert.ok(owner.range.endsWith('/2'));
      const own=await request('recipient','/flight_recipients?select=flight_id,user_id,flights(id,notes)');
      assert.equal(own.status,200);assert.equal(own.rows.length,1);assert.ok(own.range.endsWith('/1'));
      assert.equal(own.rows[0].user_id,accounts.recipient.id);assert.equal(own.rows[0].flights.id,ids.private);
      for(const label of ['other','admin','disabled','absent']){
        const result=await request(label,'/flight_recipients?flight_id=eq.'+ids.private+'&select=*,flights(id,notes)');
        assert.equal(result.status,200);assert.deepEqual(result.rows,[]);assert.ok(result.range.endsWith('/0'));
      }
      const joined=await request('recipient','/flights?select=id,flight_recipients(user_id)&order=id');
      visible(joined,[ids.network,ids.private],'Nested audience cannot widen flight visibility');
      assert.deepEqual(joined.rows.find(r=>r.id===ids.private).flight_recipients,[{user_id:accounts.recipient.id}]);
      const inner=await request('admin','/flights?select=id,flight_recipients!inner(user_id)');
      visible(inner,[],'Inner join cannot reveal hidden PRIVATE flights');
      const head=await request('admin','/flights?id=eq.'+ids.private+'&select=id',{method:'HEAD'});
      assert.equal(head.status,200);assert.ok(head.range.endsWith('/0'),'HEAD count does not disclose hidden flight');
    });
    await scenario('flight_rls_direct_mutations_and_role_spoofing',async()=>{
      const before=await snapshot();
      for(const label of [null,'owner','recipient','other','admin','disabled','absent']){
        const attacks=[
          ['/flights',{method:'POST',body:flight(randomUUID(),'owner','NETWORK','spoof')}],
          ['/flights?id=eq.'+ids.private,{method:'PATCH',body:{visibility:'NETWORK',owner_id:accounts.other.id}}],
          ['/flights?id=eq.'+ids.network,{method:'PATCH',body:{pilot_places:99}}],
          ['/flights?id=eq.'+ids.private,{method:'DELETE'}],
          ['/flight_recipients',{method:'POST',body:{flight_id:ids.private,user_id:accounts.other.id}}],
          ['/flight_recipients?flight_id=eq.'+ids.private,{method:'PATCH',body:{user_id:accounts.other.id}}],
          ['/flight_recipients?flight_id=eq.'+ids.private,{method:'DELETE'}],
          ['/memberships?user_id=eq.'+accounts.absent.id,{method:'PATCH',body:{role:'admin',status:'active'}}],
          ['/memberships',{method:'POST',body:{user_id:accounts.absent.id,role:'admin',status:'active'},prefer:'resolution=merge-duplicates,return=representation'}],
        ];
        for(const [route,options] of attacks){const result=await request(label,route,options);assert.equal(result.status,label?403:401,'Direct member/anonymous write rejected');assert.equal(result.rows.code,'42501');}
      }
      assert.deepEqual(await snapshot(),before,'Denied API mutations leave flight, recipient and membership records unchanged');
    });
    await scenario('flight_rls_private_helpers_are_not_public_rpcs',async()=>{
      for(const label of [null,'recipient','other','admin']){
        for(const name of ['viewer_has_private_access','viewer_owns_flight']){
          const result=await request(label,'/rpc/'+name,{method:'POST',body:{target_flight:ids.private}});
          assert.equal(result.status,404,'No public helper RPC');assert.equal(result.rows.code,'PGRST202');
          const privateSchema=await request(label,'/rpc/'+name,{method:'POST',profile:'flight_private',body:{target_flight:ids.private}});
          assert.equal(privateSchema.status,406,'Private schema not exposed');assert.equal(privateSchema.rows.code,'PGRST106');
        }
      }
    });
    await scenario('flight_rls_current_membership_and_recipient_revocation',async()=>{
      const retained=sessions.recipient.token;
      await stack.setMembership(accounts.recipient.id,{role:'member',status:'disabled'});
      visible(await request('recipient','/flights?select=id'),[],'Existing JWT loses flight access after disabling');
      const denied=await request('recipient','/flight_recipients?select=user_id');assert.equal(denied.status,200);assert.deepEqual(denied.rows,[]);
      assert.equal(sessions.recipient.token,retained,'JWT unchanged across membership revocation');
      await stack.setMembership(accounts.recipient.id,{role:'member',status:'active'});
      visible(await request('recipient','/flights?select=id'),[ids.network,ids.private],'Reactivation restores existing selection');
      await checked(admin.from('flight_recipients').delete().eq('flight_id',ids.private).eq('user_id',accounts.recipient.id),'Remove owned no-request selection');
      visible(await request('recipient','/flights?select=id'),[ids.network],'Selection removal revokes PRIVATE flight with unchanged JWT');
      const joined=await request('recipient','/flight_recipients?select=flight_id,flights(id,notes)');assert.equal(joined.status,200);assert.deepEqual(joined.rows,[]);
      assert.equal(sessions.recipient.token,retained);
      await checked(admin.from('flight_recipients').insert({flight_id:ids.private,user_id:accounts.recipient.id}),'Restore owned selection');
      visible(await request('recipient','/flights?select=id'),[ids.network,ids.private],'Re-add restores visibility only');
      await stack.setMembership(accounts.owner.id,{role:'member',status:'disabled'});
      visible(await request('owner','/flights?select=id'),[],'Disabled owner loses flight reads');
      const audience=await request('owner','/flight_recipients?select=user_id');assert.equal(audience.status,200);assert.deepEqual(audience.rows,[]);
      await stack.setMembership(accounts.owner.id,{role:'member',status:'active'});
    });
  }finally{
    // Restrictive FKs require clearing owned flight relationships before the
    // common stack helper deletes its tracked fictional accounts/memberships.
    await checked(admin.from('flight_recipients').delete().in('flight_id',Object.values(ids)),'Clean owned audience');
    await checked(admin.from('flights').delete().in('id',Object.values(ids)),'Clean owned flights');
    for(const client of clients)await client.auth.stopAutoRefresh();
  }
}
