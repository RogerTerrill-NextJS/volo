import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {startMutationFixture} from './helpers/mutation-fixture.mjs';

// Removing the opt-in guard, using a different member's profile, caching its
// result or allowing failed reads must break these real route/action requests.
test('profile-required mutations deny direct bypass and check fresh owner completion', {timeout:120000}, async()=>{
 const fixture=await startMutationFixture({actions:true,onboarding:true,requireCompleteProfile:true});
 try{
  const member=await fixture.seed('completion-member'),admin=await fixture.seed('completion-admin',{role:'admin'});
  const profiles=fixture.backend.profiles;
  profiles.rows.set(admin.entry.id,{user_id:admin.entry.id});
  const {encodeReply}=createRequire(import.meta.url)('next/dist/compiled/react-server-dom-webpack/client.node.js');
  const decode=value=>value.replaceAll('&quot;','"').replaceAll('&#x27;',"'").replaceAll('&amp;','&');
  const html=(await fixture.request('/')).body;
  const forms=[...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(match=>[...match[1].matchAll(/<input\b[^>]*>/g)].flatMap(input=>{
   const name=input[0].match(/name="(\$ACTION_[^"]+)"/)?.[1];return name?[[decode(name),decode(input[0].match(/value="([^"]*)"/)?.[1]??'')]]:[];
  }));
  const ids=forms.map(entries=>JSON.parse(entries.find(([key])=>key.endsWith(':0'))[1]).id);
  const invoke=async(transport,account=member,values={value:'valid'})=>{
   if(transport==='route')return fixture.request('/api/no-proxy-write',account.jar,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
   const form=new FormData();for(const [key,value] of Object.entries(values))form.set(key,value);
   if(transport==='native'){for(const [key,value] of forms[0])form.append(key,value);return fixture.request('/',account.jar,{method:'POST',body:form});}
   return fixture.request('/',account.jar,{method:'POST',body:await encodeReply([null,form]),headers:{Accept:'text/x-component','Next-Action':ids[0]}});
  };
  const denied=async(transport,code,account=member,values)=>{
   const before=fixture.effects.length,result=await invoke(transport,account,values);
   assert.equal(fixture.effects.length,before,'Denied completion must not execute the mutation');
   assert.ok(decode(result.body).includes('"code":"'+code+'"'),result.body);
   assert.match(result.response.headers.get('cache-control'),/no-store/);
   if(transport==='route')assert.equal(result.response.status,code==='unavailable'?503:code==='invalid_input'?400:403);
  };
  for(const transport of ['route','fetch','native']){
   await denied(transport,'profile_required');
   // Neither claims of completion nor another owner's identity can grant access.
   await denied(transport,'invalid_input',member,{value:'valid',profileComplete:true,requireCompleteProfile:false,user_id:admin.entry.id});
   profiles.rows.set(member.entry.id,{user_id:member.entry.id});
   let before=fixture.effects.length;
   const saved=await invoke(transport);assert.equal(saved.response.status,200);
   assert.equal(fixture.effects.length,before+1);assert.equal(fixture.effects.at(-1).userId,member.entry.id);
   member.entry.status='disabled';await denied(transport,'forbidden');member.entry.status='active';
   profiles.rows.delete(member.entry.id);await denied(transport,'profile_required');
   profiles.rows.delete(admin.entry.id);await denied(transport,'profile_required',admin);
   profiles.rows.set(admin.entry.id,{user_id:admin.entry.id});
   before=fixture.effects.length;await invoke(transport,admin);assert.equal(fixture.effects.length,before+1);
   profiles.failure='down';await denied(transport,'unavailable');profiles.failure=null;
   profiles.rows.set(member.entry.id,{user_id:admin.entry.id});await denied(transport,'unavailable');profiles.rows.delete(member.entry.id);
  }
  const start=Date.now();profiles.failure='body';await denied('route','unavailable');
  assert.ok(Date.now()-start<8000,'Stalled completion reads must time out');profiles.failure=null;
  const page=await fixture.request('/dashboard',member.jar);
  assert.match(page.body,/Workspace overview/);assert.match(page.body,/href="\/onboarding"/);
  assert.match(page.body,/before posting or requesting a flight/);
  for(const call of fixture.backend.calls.filter(call=>call.service==='profiles')){
   assert.equal(call.method,'GET');assert.equal(call.select,'user_id');assert.equal(call.filter,`eq.${call.subject}`);
  }
  assert.deepEqual(fixture.backend.unexpected,[]);fixture.clean(fixture.output);
 }finally{await fixture.close();}
});
