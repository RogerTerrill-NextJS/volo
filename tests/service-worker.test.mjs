import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {test} from 'node:test';
const origin='https://volo.example';
const icons=['/pwa/icon-192.png','/pwa/icon-512.png','/icon.svg','/apple-icon.png'];
async function fixture(){
 const listeners=new Map(),stores=new Map(),calls=[];let online=true,reply;
 const caches={async keys(){return [...stores.keys()];},async delete(name){return stores.delete(name);},async open(name){if(!stores.has(name))stores.set(name,new Map());const entries=stores.get(name);return {async match(key){return entries.get(String(key))?.clone();},async put(key,value){entries.set(String(key),value.clone());}};}};
 const self={location:{origin},addEventListener:(name,fn)=>listeners.set(name,fn),skipWaiting:async()=>{self.skipped=true;},clients:{claim:async()=>{self.claimed=true;}}};
 const image=(type='image/png',headers={})=>{const r=new Response('public-icon',{headers:{'content-type':type,...headers}});Object.defineProperty(r,'type',{value:'basic',configurable:true});return r;};
 vm.runInNewContext(await readFile(new URL('../public/sw.js',import.meta.url),'utf8'),{self,caches,URL,Request,Response,Promise,fetch:async request=>{calls.push(request);if(!online)throw Error('offline');return reply?await reply():image(request.url.endsWith('.svg')?'image/svg+xml':'image/png');}});
 const dispatch=(name,request)=>{const pending=[];let response;listeners.get(name)({request,waitUntil:p=>pending.push(p),respondWith:p=>{response=p;}});return {response,done:()=>Promise.all(pending)};};
 return {stores,caches,calls,self,image,dispatch,setOnline:value=>{online=value;},setReply:value=>{reply=value;},request:(path,options={})=>new Request(new URL(path,origin),options)};
}
test('install caches only explicit public icons without credentials; activation removes only obsolete owned caches',async()=>{
 const f=await fixture();await f.dispatch('install').done();assert.equal(f.self.skipped,true);
 assert.deepEqual(f.calls.map(r=>new URL(r.url).pathname).sort(),[...icons].sort());
 assert.ok(f.calls.every(r=>r.credentials==='omit'&&r.cache==='no-store'&&r.redirect==='error'));
 await f.caches.open('volo-static-old');await f.caches.open('unrelated-cache');await f.dispatch('activate').done();
 assert.equal(f.self.claimed,true);assert.deepEqual((await f.caches.keys()).sort(),['unrelated-cache','volo-static-v1']);
});
test('private HTML/RSC/API/auth/token/query and write requests are never intercepted or queued',async()=>{
 const f=await fixture();
 for(const path of ['/','/dashboard','/messages','/api/private','/auth/confirm?token_hash=secret','/auth/login','/auth/logout?next=x','/manifest.webmanifest','/sw.js','/pwa/icon-192.png?token=secret','/pwa/icon-192.png/child','https://foreign.example/pwa/icon-192.png'])
  assert.equal(f.dispatch('fetch',f.request(path)).response,undefined,path);
 for(const header of ['RSC','Next-Router-Prefetch','Next-Router-State-Tree','Authorization','Range'])
  assert.equal(f.dispatch('fetch',f.request(icons[0],{headers:{[header]:'canary'}})).response,undefined,header);
 for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal(f.dispatch('fetch',f.request('/api/write',{method})).response,undefined);
 const navigation={...f.request(icons[0]),url:origin+icons[0],method:'GET',mode:'navigate',headers:new Headers()};assert.equal(f.dispatch('fetch',navigation).response,undefined);
 assert.equal(f.calls.length,0);assert.deepEqual(await f.caches.keys(),[]);
});
test('cached icons work offline; uncached requests fail without synthetic success',async()=>{
 const f=await fixture();await f.dispatch('install').done();f.setOnline(false);
 assert.equal(await (await f.dispatch('fetch',f.request(icons[0])).response).text(),'public-icon');
 await f.caches.delete('volo-static-v1');await assert.rejects(f.dispatch('fetch',f.request(icons[0])).response,/offline/);
 assert.equal(f.dispatch('fetch',f.request('/api/write',{method:'POST'})).response,undefined);
});
test('unsafe image responses cannot enter the cache',async()=>{
 for(const [type,headers] of [['text/html',{}],['image/png',{'cache-control':'private'}],['image/png',{'cache-control':'no-store'}],['image/png',{'vary':'Cookie'}],['image/png',{'vary':'Authorization'}]]){
  const f=await fixture();f.setReply(()=>f.image(type,headers));await assert.rejects(f.dispatch('install').done());
  assert.ok([...f.stores.values()].every(entries=>entries.size===0));
 }
 for(const property of ['redirected','type','status']){
  const f=await fixture();f.setReply(()=>{const r=f.image();Object.defineProperty(r,property,{value:property==='redirected'?true:property==='type'?'opaque':500});return r;});await assert.rejects(f.dispatch('install').done());
 }
});
test('logout clears owned caches without intercepting auth or allowing an older fetch to refill them',async()=>{
 const f=await fixture();await f.dispatch('install').done();await f.caches.open('unrelated-cache');
 await f.caches.delete('volo-static-v1');let release;f.setReply(()=>new Promise(resolve=>{release=resolve;}));
 const pending=f.dispatch('fetch',f.request(icons[0])).response;
 // Let the cache miss reach fetch before dispatching logout.
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 const logout=f.dispatch('fetch',f.request('/auth/logout',{method:'POST'}));assert.equal(logout.response,undefined);await logout.done();
 release(f.image());await pending;assert.deepEqual(await f.caches.keys(),['unrelated-cache']);
 for(const path of ['/auth/logout','/auth/logout/']){await f.caches.open('volo-static-v1');await f.dispatch('fetch',f.request(path,{method:'POST'})).done();assert.deepEqual(await f.caches.keys(),['unrelated-cache']);}
});
