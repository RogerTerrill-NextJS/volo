import assert from 'node:assert/strict';
import {test} from 'node:test';

const load=()=>import('./helpers/real-auth-session.mjs');
test('cookie_jars_do_not_share_state',async()=>{
  const {createCookieJar}=await load();const a=createCookieJar([{name:'session',value:'A'}]),b=createCookieJar([{name:'session',value:'B'}]);
  a.applyResponse(new Response(null,{headers:{'set-cookie':'session=A2; Path=/'}}));
  assert.equal(a.cookieHeader(),'session=A2');assert.equal(b.cookieHeader(),'session=B');
});
test('applies_multiple_cookie_headers_and_chunk_deletions',async()=>{
  const {createCookieJar}=await load();const jar=createCookieJar([{name:'session.0',value:'old'},{name:'session.1',value:'tail'}]);
  const headers=new Headers();headers.append('set-cookie','session.0=new; Path=/; Expires=Wed, 07 Oct 2037 00:00:00 GMT');headers.append('set-cookie','session.1=; Max-Age=0; Path=/');
  jar.applyResponse(new Response(null,{headers}));assert.equal(jar.cookieHeader(),'session.0=new');
});
test('clone_preserves_retained_credentials',async()=>{
  const {createCookieJar}=await load();const original=createCookieJar([{name:'session',value:'old'}]),retained=original.clone();
  original.applyResponse(new Response(null,{headers:{'set-cookie':'session=; Max-Age=0'}}));assert.equal(original.cookieHeader(),'');assert.equal(retained.cookieHeader(),'session=old');
});
