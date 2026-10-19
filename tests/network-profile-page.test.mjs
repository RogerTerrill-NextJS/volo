import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startMutationFixture} from './helpers/mutation-fixture.mjs';

test('network profile opens the requested pilot read-only with private HTML/RSC and safe missing/error states',{timeout:120000},async()=>{
 const fixture=await startMutationFixture({onboarding:true,photos:true});
 try{
  const viewer=await fixture.seed('network-viewer'),admin=await fixture.seed('network-admin',{role:'admin'});
  const target='6a000000-0000-4000-8000-000000000002',missing='6a000000-0000-4000-8000-000000000099';
  const route=`/directory/${target}`;
  const profile={user_id:target,display_name:'Morgan <Ellis>',home_airport:'KPAO',pilot_designation:'licensed',certificates:['Private pilot'],ratings:['Instrument'],aircraft_access:'Club C172',flying_interests:'Coastal flying',bio:'Local flying biography',photo_available:true,email:'private-profile-email-canary',role:'private-profile-role-canary',photo_storage_path:'private-profile-path-canary'};
  fixture.backend.directory.rows=[profile];
  const reads=()=>fixture.backend.calls.filter(call=>call.service==='network-profile');
  const read=async(path=route,jar=viewer.jar,init={})=>{
   const result=await fixture.request(path,jar,init);
   for(const key of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(result.response.headers.get(key),/no-store/);
   assert.doesNotMatch(result.body,/private-profile-email-canary|private-profile-role-canary|private-profile-path-canary/);
   return result;
  };
  let page=await read();assert.equal(page.response.status,200);
  assert.match(page.body,/<h1[^>]*>Morgan &lt;Ellis&gt;<\/h1>/);
  for(const value of ['KPAO','Private pilot','Instrument','Club C172','Coastal flying','Local flying biography'])assert.ok(page.body.includes(value));
  assert.match(page.body,new RegExp(`/api/profiles/${target}/photo\\?v=0`));
  assert.match(page.body,/Back to directory/);
  assert.doesNotMatch(page.body,/name="display_name"|Save profile|Remove photo|Upload photo/);
  assert.deepEqual(reads().at(-1),{service:'network-profile',subject:viewer.entry.id,method:'POST',payload:{p_user_id:target}});
  await read(`${route}?user_id=${viewer.entry.id}`);assert.equal(reads().at(-1).payload.p_user_id,target,'Query strings cannot change the requested pilot');
  page=await read(route,admin.jar);assert.match(page.body,/Morgan &lt;Ellis&gt;/);assert.doesNotMatch(page.body,/Save profile|Remove photo/);
  fixture.backend.directory.rows.push({...profile,user_id:viewer.entry.id,photo_available:false});
  page=await read(`/directory/${viewer.entry.id}`);assert.match(page.body,/No profile photo available/);assert.doesNotMatch(page.body,/Save profile|Remove photo/);
  const directory=await read('/directory');assert.match(directory.body,new RegExp(`href="/directory/${target}"`));
  let before=reads().length;
  page=await read('/directory/not-a-uuid');assert.equal(page.response.status,404);assert.match(page.body,/Profile not found/);assert.equal(reads().length,before);
  page=await read(`/directory/${missing}`);assert.equal(page.response.status,404);assert.match(page.body,/Profile not found/);
  before=reads().length;
  page=await read(route,new Map());assert.equal(page.response.headers.get('location'),'/login?reason=authentication-required');assert.equal(reads().length,before);
  viewer.entry.status='disabled';page=await read();assert.match(page.body,/Access denied/);assert.doesNotMatch(page.body,/Local flying biography/);assert.equal(reads().length,before);viewer.entry.status='active';
  viewer.entry.membership='absent';page=await read();assert.match(page.body,/Access denied/);assert.equal(reads().length,before);viewer.entry.membership=undefined;
  fixture.backend.directory.failure='down';page=await read();assert.match(page.body,/Profile temporarily unavailable/);assert.match(page.body,/Try again/);assert.doesNotMatch(page.body,/<h1[^>]*>Profile not found<\/h1>|Local flying biography/);fixture.backend.directory.failure=null;
  async function rscRead(jar){
   let path=route+'?_rsc=network-profile';
   for(let i=0;i<3;i++){
    const reply=await read(path,jar,{headers:{RSC:'1'}}),location=reply.response.headers.get('location');
    if(reply.response.status!==307||!location||new URL(location,fixture.origin).pathname!==route)return reply;
    const destination=new URL(location,fixture.origin);assert.equal(destination.origin,fixture.origin);path=destination.pathname+destination.search;
   }
   throw Error('RSC canonicalization did not finish');
  }
  page=await rscRead(viewer.jar);assert.equal(page.response.status,200);assert.match(page.body,/Local flying biography/);
  viewer.entry.status='disabled';page=await rscRead(viewer.jar);assert.match(page.body,/Access denied/);assert.doesNotMatch(page.body,/Local flying biography/);
  page=await rscRead(new Map());assert.match(page.response.headers.get('location')??page.body,/\/login\?reason=authentication-required/);assert.doesNotMatch(page.body,/Local flying biography/);
  assert.equal(fixture.backend.profiles.writes.length,0);assert.deepEqual(fixture.backend.unexpected,[]);
 }finally{await fixture.close();}
});
