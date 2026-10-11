import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {startMutationFixture} from './helpers/mutation-fixture.mjs';

// Removing the real action's validator, membership/origin gate, owner filter or
// restricted payload must break the save/no-save evidence in this existing fixture.
test('profile Server Actions validate and save only the current active owner', {timeout:120000}, async()=>{
  const fixture=await startMutationFixture({actions:true,profiles:true});
  try{
    const member=await fixture.seed('profile-member'),other=await fixture.seed('profile-other',{role:'admin'});
    const backend=fixture.backend.profiles;
    backend.rows.set(other.entry.id,{user_id:other.entry.id,display_name:'Other pilot',photo_storage_path:'owned/photo.jpg'});
    const {encodeReply}=createRequire(import.meta.url)('next/dist/compiled/react-server-dom-webpack/client.node.js');
    const html=(await fixture.request('/')).body;
    const decode=value=>value.replaceAll('&quot;','"').replaceAll('&#x27;',"'").replaceAll('&amp;','&');
    const ids=[...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(match=>{
      const input=[...match[1].matchAll(/<input\b[^>]*>/g)].find(input=>/name="\$ACTION_[^"]+:0"/.test(input[0]));
      assert.ok(input,'Expected a compiled profile action');
      return JSON.parse(decode(input[0].match(/value="([^"]*)"/)[1])).id;
    });
    assert.equal(ids.length,2);
    const invoke=async(index=0,account=member,overrides={},headers={})=>{
      const form=new FormData();
      for(const [key,value] of Object.entries({display_name:' Student Pilot ',home_airport:' kpao ',pilot_designation:'student',certificates:'Glider\n Private pilot ',ratings:'',aircraft_access:'Club rental',bio:'Hello',...overrides}))form.set(key,value);
      const result=await fixture.request('/',account.jar,{method:'POST',body:await encodeReply([null,form]),headers:{Accept:'text/x-component','Next-Action':ids[index],...headers}});
      assert.equal(result.response.status,200,result.body);
      assert.match(result.response.headers.get('cache-control'),/no-store/);
      return result.body;
    };
    assert.match(await invoke(),/"code":"saved"/);
    assert.deepEqual(backend.rows.get(member.entry.id),{
      user_id:member.entry.id,display_name:'Student Pilot',home_airport:'KPAO',pilot_designation:'student',certificates:['Glider','Private pilot'],ratings:[],aircraft_access:'Club rental',flying_interests:null,bio:'Hello',
    });
    backend.rows.get(member.entry.id).photo_storage_path='member/photo.jpg';
    assert.match(await invoke(1,member,{bio:'',aircraft_access:''}),/"code":"saved"/);
    assert.equal(backend.rows.get(member.entry.id).bio,null);
    assert.equal(backend.rows.get(member.entry.id).photo_storage_path,'member/photo.jpg');
    assert.equal(backend.rows.get(other.entry.id).display_name,'Other pilot');
    const calls=fixture.backend.calls.filter(call=>call.service==='profiles');
    assert.equal(calls[0].method,'POST');assert.equal(calls[0].filter,null);
    assert.equal(calls[1].method,'PATCH');assert.equal(calls[1].filter,`eq.${member.entry.id}`);
    for(const call of calls){assert.equal(call.select,'user_id');assert.equal(Object.hasOwn(call.payload,'user_id'),false);assert.equal(Object.hasOwn(call.payload,'photo_storage_path'),false);}

    // Every individual field is legal; their combined UTF-8 bytes must fit too.
    const maximum={display_name:'😀'.repeat(80),home_airport:'12345678',pilot_designation:'licensed',
      certificates:Array(20).fill('😀'.repeat(80)).join('\n'),ratings:Array(20).fill('😀'.repeat(80)).join('\n'),
      aircraft_access:'😀'.repeat(500),flying_interests:'😀'.repeat(500),bio:'😀'.repeat(2000)};
    assert.match(await invoke(1,member,maximum),/"code":"saved"/);
    assert.equal(backend.rows.get(member.entry.id).bio,maximum.bio);
    assert.match(await invoke(1,member),/"code":"saved"/);

    const noWrite=async(run,code)=>{
      const before=backend.writes.length,body=await run();
      assert.match(body,new RegExp('"code":"'+code+'"'));assert.equal(backend.writes.length,before);return body;
    };
    const invalid=await noWrite(()=>invoke(1,member,{display_name:'',home_airport:'!',bio:'a'.repeat(2001)}),'invalid_input');
    assert.match(invalid,/"fieldErrors":\{/);assert.match(invalid,/"display_name":/);assert.match(invalid,/"home_airport":/);assert.match(invalid,/"bio":/);
    for(const field of ['user_id','role','updated_at','photo_storage_path'])await noWrite(()=>invoke(1,other,{[field]:member.entry.id}),'invalid_input');
    await noWrite(()=>invoke(1,member,{bio:' '.repeat(32768)}),'too_large');
    other.entry.status='disabled';await noWrite(()=>invoke(1,other),'forbidden');other.entry.status='active';
    await noWrite(()=>invoke(1,member,{}, {Origin:null}),'forbidden');
    await noWrite(()=>invoke(0,member),'conflict');
    const missing=await fixture.seed('profile-missing');await noWrite(()=>invoke(1,missing),'conflict');
    for(const failure of ['down','body']){
      backend.failure=failure;
      const before=fixture.backend.calls.filter(call=>call.service==='profiles').length;
      await noWrite(()=>invoke(1,member),'unavailable');
      assert.equal(fixture.backend.calls.filter(call=>call.service==='profiles').length,before+1,'Failed writes are not retried');
    }
    backend.failure=null;
    assert.match(await invoke(1,other,{display_name:'Administrator pilot',pilot_designation:'licensed'}),/"code":"saved"/);
    assert.equal(backend.rows.get(other.entry.id).display_name,'Administrator pilot');
    assert.equal(backend.rows.get(other.entry.id).photo_storage_path,'owned/photo.jpg');
    assert.equal(backend.rows.get(member.entry.id).display_name,'Student Pilot');
    assert.deepEqual(fixture.backend.unexpected,[]);fixture.clean(fixture.output);
  }finally{await fixture.close();}
});
