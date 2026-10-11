import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startMutationFixture} from './helpers/mutation-fixture.mjs';

// A foreign-owner read, unguarded update, or lost action feedback must break
// this regression against the actual compiled edit page and Server Action.
test('profile editing loads and saves only the active owner with recoverable feedback', {timeout:120000}, async()=>{
 const fixture=await startMutationFixture({onboarding:true});
 try{
  const owner=await fixture.seed('edit-owner'),other=await fixture.seed('edit-other',{role:'admin'}),missing=await fixture.seed('edit-missing');
  const profiles=fixture.backend.profiles;
  const original={user_id:owner.entry.id,display_name:'Original pilot',home_airport:'KPAO',pilot_designation:'licensed',certificates:['Private pilot','Glider'],ratings:['Instrument'],aircraft_access:'Club aircraft',flying_interests:'Cross country',bio:'Original biography',photo_storage_path:'private-photo'};
  profiles.rows.set(owner.entry.id,original);
  profiles.rows.set(other.entry.id,{...original,user_id:other.entry.id,display_name:'Other pilot'});
  let page=await fixture.request('/profile/edit?user_id='+other.entry.id,owner.jar);
  assert.equal(page.response.status,200);
  assert.match(page.response.headers.get('cache-control'),/no-store/);
  assert.match(page.body,/value="Original pilot"/);
  assert.match(page.body,/Private pilot\nGlider<\/textarea>/);
  assert.match(page.body,/Original biography<\/textarea>/);
  assert.doesNotMatch(page.body,/Other pilot|private-photo|name="user_id"/);
  assert.match(page.body,/href="\/profile\/edit"/);
  assert.equal((await fixture.request('/profile/edit',missing.jar)).response.headers.get('location'),'/onboarding');
  assert.match((await fixture.request('/profile/edit')).response.headers.get('location'),/^\/login\?/);
  const decode=value=>value.replaceAll('&quot;','"').replaceAll('&#x27;',"'").replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>');
  async function submit(html,values,jar=owner.jar){
   const match=[...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].find(match=>match[1].includes('profile-display_name'));
   assert.ok(match,'Expected the real profile edit form');
   const form=new FormData();
   for(const input of match[1].matchAll(/<input\b[^>]*>/g)){
    const name=input[0].match(/name="([^"]*)"/),value=input[0].match(/value="([^"]*)"/);
    if(name?.[1].startsWith('$ACTION_'))form.append(decode(name[1]),decode(value?.[1]??''));
   }
   for(const [key,value] of Object.entries(values))form.set(key,value);
   return fixture.request('/profile/edit',jar,{method:'POST',body:form});
  }
  const values={display_name:' Updated pilot ',home_airport:' ksfo ',pilot_designation:'student',certificates:'Glider',ratings:'',aircraft_access:'',flying_interests:'Local flying',bio:'Updated biography'};
  let result=await submit(page.body,{...values,home_airport:''});
  assert.equal(profiles.writes.length,0);
  assert.match(result.body,/id="profile-home_airport-error"/);
  assert.match(result.body,/Updated biography<\/textarea>/);
  result=await submit(result.body,{...values,user_id:other.entry.id});
  assert.equal(profiles.writes.length,0);
  assert.match(result.body,/unsupported fields/);
  result=await submit(result.body,values);
  assert.equal(result.response.status,200);
  assert.match(result.body,/role="status"[^>]*>[\s\S]*?Profile saved/);
  assert.match(result.body,/value="Updated pilot"/);assert.match(result.body,/value="KSFO"/);
  assert.equal(profiles.writes.length,1);
  assert.equal(profiles.writes[0].method,'PATCH');
  assert.equal(profiles.rows.get(owner.entry.id).display_name,'Updated pilot');
  assert.equal(profiles.rows.get(owner.entry.id).aircraft_access,null);
  assert.deepEqual(profiles.rows.get(owner.entry.id).ratings,[]);
  assert.equal(profiles.rows.get(owner.entry.id).photo_storage_path,'private-photo');
  assert.equal(profiles.rows.get(other.entry.id).display_name,'Other pilot');
  profiles.failure='down';
  result=await submit(result.body,{...values,bio:'Recover this biography'});
  assert.match(result.body,/Recover this biography<\/textarea>/);
  assert.match(result.body,/Reload your profile/);
  assert.match(result.body,/<button[^>]*disabled[^>]*>Save profile/);
  assert.equal(profiles.writes.length,1);
  assert.doesNotMatch((await fixture.request('/profile/edit',owner.jar)).body,/id="profile-display_name"/);
  profiles.failure=null;
  owner.entry.status='disabled';
  assert.doesNotMatch((await fixture.request('/profile/edit',owner.jar)).body,/id="profile-display_name"/);
  await submit(page.body,values);assert.equal(profiles.writes.length,1);
  owner.entry.status='active';
  profiles.rows.set(owner.entry.id,{...original,user_id:other.entry.id});
  assert.doesNotMatch((await fixture.request('/profile/edit',owner.jar)).body,/id="profile-display_name"/);
  assert.deepEqual(fixture.backend.unexpected,[]);fixture.clean(fixture.output);
 }finally{await fixture.close();}
});
