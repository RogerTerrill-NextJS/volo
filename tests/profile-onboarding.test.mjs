import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startMutationFixture} from './helpers/mutation-fixture.mjs';

// Removing the page access check, own-profile lookup, validation feedback or
// confirmed-save redirect must break these requests to the actual compiled app.
test('onboarding prompts incomplete members and saves through the accessible form', {timeout:120000}, async()=>{
 const fixture=await startMutationFixture({onboarding:true});
 try{
  const member=await fixture.seed('onboarding-member'),other=await fixture.seed('onboarding-other',{role:'admin'});
  const profiles=fixture.backend.profiles;
  profiles.rows.set(other.entry.id,{user_id:other.entry.id,display_name:'Other pilot'});
  let page=await fixture.request('/onboarding',member.jar);
  assert.equal(page.response.status,200);
  assert.match(page.body,/<label[^>]*for="profile-display_name"/);
  assert.match(page.body,/<input[^>]*type="checkbox"[^>]*name="pilot_designation"[^>]*value="licensed"/);
  assert.match(page.body,/I am a licensed pilot/);
  assert.doesNotMatch(page.body,/Student pilot|type="radio"/);
  assert.match(page.body,/href="\/dashboard"/);
  assert.match(page.response.headers.get('cache-control'),/no-store/);
  assert.match((await fixture.request('/dashboard',member.jar)).body,/href="\/onboarding"/);
  assert.doesNotMatch((await fixture.request('/dashboard',other.jar)).body,/href="\/onboarding"/);
  assert.equal((await fixture.request('/onboarding',other.jar)).response.headers.get('location'),'/dashboard?from=profile-onboarding');
  assert.match((await fixture.request('/onboarding')).response.headers.get('location'),/^\/login\?/);
  other.entry.status='disabled';
  assert.doesNotMatch((await fixture.request('/onboarding',other.jar)).body,/id="profile-display_name"/);
  other.entry.status='active';

  const decode=value=>value.replaceAll('&quot;','"').replaceAll('&#x27;',"'").replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>');
  const submit=async(html,values)=>{
   const match=[...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].find(match=>match[1].includes('profile-display_name'));
   assert.ok(match,'Expected the real onboarding form');
   const form=new FormData();
   for(const input of match[1].matchAll(/<input\b[^>]*>/g)){
    const name=input[0].match(/name="([^"]*)"/),value=input[0].match(/value="([^"]*)"/);
    if(name?.[1].startsWith('$ACTION_'))form.append(decode(name[1]),decode(value?.[1]??''));
   }
   for(const [key,value] of Object.entries(values))form.set(key,value);
   return fixture.request('/onboarding',member.jar,{method:'POST',body:form});
  };
  const invalid=await submit(page.body,{display_name:'Retained pilot',home_airport:'',pilot_designation:'licensed',bio:'Retained biography'});
  assert.equal(profiles.writes.length,0);
  assert.match(invalid.body,/aria-invalid="true"/);
  assert.match(invalid.body,/id="profile-home_airport-error"/);
  assert.match(invalid.body,/value="Retained pilot"/);assert.match(invalid.body,/Retained biography<\/textarea>/);
  profiles.failure='down';
  const failed=await submit(invalid.body,{display_name:'Retained pilot',home_airport:'KPAO',pilot_designation:'licensed',bio:'Retained biography'});
  assert.equal(profiles.writes.length,0);
  assert.match(failed.body,/Reload your profile/);
  assert.match(failed.body,/<button[^>]*disabled[^>]*>Save profile and continue/);
  assert.match(failed.body,/Retained biography<\/textarea>/);
  profiles.failure=null;
  page=await fixture.request('/onboarding',member.jar);
  const saved=await submit(page.body,{display_name:' Licensed Pilot ',home_airport:' kpao ',pilot_designation:'licensed',certificates:'Glider\nPrivate pilot',bio:'Hello'});
  assert.equal(saved.response.status,303);
  assert.equal(saved.response.headers.get('location'),'/dashboard?from=profile-onboarding');
  assert.equal(profiles.rows.get(member.entry.id).display_name,'Licensed Pilot');
  assert.equal(profiles.rows.get(member.entry.id).home_airport,'KPAO');
  assert.deepEqual(profiles.rows.get(member.entry.id).certificates,['Glider','Private pilot']);
  assert.equal(profiles.rows.get(other.entry.id).display_name,'Other pilot');
  assert.doesNotMatch((await fixture.request('/dashboard',member.jar)).body,/href="\/onboarding"/);

  const fresh=await fixture.seed('onboarding-failure');
  profiles.failure='down';
  const unavailable=await fixture.request('/onboarding',fresh.jar);
  assert.doesNotMatch(unavailable.body,/id="profile-display_name"/);
  assert.match(unavailable.body,/href="\/onboarding"/);
  assert.match((await fixture.request('/dashboard',fresh.jar)).body,/Workspace overview/);
  profiles.failure=null;
  profiles.rows.set(fresh.entry.id,{user_id:other.entry.id});
  assert.doesNotMatch((await fixture.request('/onboarding',fresh.jar)).body,/id="profile-display_name"/);
  assert.deepEqual(fixture.backend.unexpected,[]);fixture.clean(fixture.output);
 }finally{await fixture.close();}
});
