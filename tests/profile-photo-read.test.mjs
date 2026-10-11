import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startMutationFixture} from './helpers/mutation-fixture.mjs';

// Exposing a public URL, skipping fresh membership, or accepting arbitrary
// Storage paths must break this check against the actual compiled endpoint.
test('current photos are served privately to active members with safe missing/error responses',{timeout:120000},async()=>{
 const fixture=await startMutationFixture({onboarding:true,photos:true});
 try{
  const owner=await fixture.seed('photo-reader-owner'),viewer=await fixture.seed('photo-reader-viewer');
  const id=owner.entry.id,key=`${id}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp`;
  fixture.backend.profiles.rows.set(id,{user_id:id,photo_storage_path:key});
  fixture.backend.photos.objects.set(key,Buffer.from('RIFF representative fixture WEBP'));
  const route=`/api/profiles/${id}/photo`;
  let result=await fixture.request(route,viewer.jar);
  assert.equal(result.response.status,200);assert.equal(result.response.headers.get('content-type'),'image/webp');
  for(const name of ['cache-control','cdn-cache-control','netlify-cdn-cache-control'])assert.match(result.response.headers.get(name),/no-store/);
  assert.equal(result.body,'RIFF representative fixture WEBP');
  assert.equal(fixture.backend.photos.reads.at(-1).subject,viewer.entry.id);
  const reads=fixture.backend.photos.reads.length;
  assert.equal((await fixture.request(route)).response.status,401);
  viewer.entry.status='disabled';assert.equal((await fixture.request(route,viewer.jar)).response.status,403);
  assert.equal(fixture.backend.photos.reads.length,reads);viewer.entry.status='active';
  assert.equal((await fixture.request('/api/profiles/not-a-user/photo',viewer.jar)).response.status,404);
  fixture.backend.profiles.rows.get(id).photo_storage_path='another-owner/private-photo';
  assert.equal((await fixture.request(route,viewer.jar)).response.status,404);assert.equal(fixture.backend.photos.reads.length,reads);
  fixture.backend.profiles.rows.get(id).photo_storage_path=key;
  fixture.backend.photos.failure='down';result=await fixture.request(route,viewer.jar);
  assert.equal(result.response.status,503);assert.doesNotMatch(result.body,/private-access|private-photo|profile-photos|bbbbbbbb/);
  fixture.backend.photos.failure=null;fixture.backend.photos.objects.delete(key);
  assert.equal((await fixture.request(route,viewer.jar)).response.status,404);
  assert.deepEqual(fixture.backend.unexpected,[]);
 }finally{await fixture.close();}
});
