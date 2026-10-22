import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import path from "node:path";
import {createSharedCache} from "../tests/helpers/shared-cache.mjs";
import {startCacheFixture} from "../tests/helpers/cache-fixture.mjs";

const fixture=await startCacheFixture();
const cache=createSharedCache();
const membership=()=>fixture.backend.calls.filter(x=>x.service==="membership").length;
const policy=reply=>{
  assert.match(reply.headers.get("cache-control"),/no-store/);
  for(const field of ["cdn-cache-control","netlify-cdn-cache-control"])assert.equal(reply.headers.get(field),"no-store");
};
const absorb=(reply,jar)=>{
  for(const value of reply.headers.getSetCookie()){
    const pair=value.split(";",1)[0],index=pair.indexOf("=");
    if(/max-age=0(?:;|$)/i.test(value))jar.delete(pair.slice(0,index));
    else jar.set(pair.slice(0,index),pair.slice(index+1));
  }
};
try {
  const {A,B}=fixture.accounts;
  // Actual homepage: redirects are decisions, not cacheable grants.
  for(const headers of [{},{RSC:'1'},{RSC:'1','Next-Router-Prefetch':'1'}]){
    for(const account of [null,A,B,null,A]){
      const {reply,hit}=await cache.request('home'+JSON.stringify(headers),()=>fixture.request('/?next=https://foreign.invalid&token=homepage-query-canary',account?.jar,headers));
      assert.equal(hit,false);policy(reply);
      const expected=account?'/dashboard/flights?source=home':'/login?reason=authentication-required';
      // Next can omit dynamic content entirely during a static prefetch.
      if(headers['Next-Router-Prefetch']&&reply.status===200&&!reply.body.includes('NEXT_REDIRECT')){
        assert.equal(reply.headers.get('location'),null);
        assert.ok(!reply.body.includes(A.entry.id)&&!reply.body.includes(B.entry.id));continue;
      }
      if(headers.RSC&&reply.status===200)assert.ok(reply.body.includes('NEXT_REDIRECT;replace;'+expected+';307;'),'RSC carries the fixed redirect instruction');
      else assert.equal(reply.status,307);
      const location=new URL(reply.headers.get('location')??expected,fixture.origin);
      assert.equal(location.origin,fixture.origin);
      assert.equal(location.pathname,account?'/dashboard/flights':'/login');
      assert.equal(location.search,account?'?source=home':'?reason=authentication-required');
      // Next may serialize the original request URL; only the redirect target must be fixed.
      assert.doesNotMatch(reply.body,/NEXT_REDIRECT;[^;]*;[^;]*homepage-query-canary/);
    }
  }
  for(const mode of ['disabled','absent','membership-outage','auth-outage']){
    const old={status:A.entry.status,membership:A.entry.membership,auth:A.entry.auth};
    if(mode==='disabled')A.entry.status='disabled';
    if(mode==='absent')A.entry.membership='absent';
    if(mode==='membership-outage')A.entry.membership='down';
    if(mode==='auth-outage')A.entry.auth='down';
    try{
      const reply=await fixture.request('/',A.jar);policy(reply);
      assert.equal(reply.headers.get('location'),null);
      assert.match(reply.body,mode.endsWith('outage')?/unavailable|Unable to verify/i:/Access denied/);
    }finally{Object.assign(A.entry,old);}
  }
  const first=await fixture.request('/');
  const loginDestination=new URL(first.headers.get('location'),fixture.origin);
  const landing=await fixture.request(loginDestination.pathname+loginDestination.search);assert.equal(landing.status,200);assert.equal(landing.headers.get('location'),null);
  console.log('PASS: homepage routes anonymous/active viewers, denies inactive/unadmitted viewers, fails closed on outages and strips incoming query parameters');

  for(const route of ["/dashboard/cache-check","/api/cache-check"]){
    const variants=route.startsWith("/dashboard")?[{}, {RSC:"1"},{RSC:"1","Next-Router-Prefetch":"1"}]:[{}];
    for(const headers of variants)for(const throughCache of [false,true])for(const account of [A,B,null,A]){
      const before=membership(),jar=account?.jar??new Map();
      const load=()=>fixture.request(route,jar,headers);
      const {reply,hit}=throughCache?await cache.request(route+JSON.stringify(headers),load):{reply:await load(),hit:false};
      assert.equal(hit,false);policy(reply);
      if(account){
        const omittedPrefetch=headers["Next-Router-Prefetch"] && !reply.body.includes(account.entry.id);
        assert.equal(membership(),before+(omittedPrefetch?0:1));
        assert.doesNotMatch(reply.body,new RegExp((account===A?B:A).entry.id));
        if(!headers["Next-Router-Prefetch"])assert.ok(reply.body.includes(account.entry.id));
        const foreign=account===A?B:A;
        for(const value of foreign.jar.values())assert.ok(!reply.headers.getSetCookie().join("\n").includes(value));
        absorb(reply,jar);
      }else{
        assert.equal(membership(),before);
        assert.ok(!reply.body.includes(A.entry.id) && !reply.body.includes(B.entry.id));
        assert.equal(reply.headers.getSetCookie().length,0);
      }
    }
    const key=route+"warm";
    const request=async()=>{const result=await cache.request(key,()=>fixture.request(route,A.jar));assert.equal(result.hit,false);policy(result.reply);return result.reply;};
    await request();A.entry.status="disabled";
    let before=membership(),reply=await request();assert.equal(membership(),before+1);assert.ok(!reply.body.includes(A.entry.id));assert.match(reply.body,/forbidden|Access denied/);
    A.entry.status="active";await request();
    for(const service of ["auth","membership"]){
      A.entry[service]="down";reply=await request();assert.ok(!reply.body.includes(A.entry.id));assert.match(reply.body,/unavailable|Unable to verify/i);
      A.entry[service]=undefined;assert.ok((await request()).body.includes(A.entry.id));
    }
  }
  for(const [label,options] of [["expired",{expired:true}],["rejected",{auth:"rejected"}]]){
    const account=await fixture.seed(label,options);const reply=await fixture.request("/dashboard/cache-check",account.jar);policy(reply);
    if(label==="expired"){assert.ok(reply.body.includes(account.entry.id));assert.ok(reply.headers.getSetCookie().length);absorb(reply,account.jar);}
    else {assert.ok(!reply.body.includes(account.entry.id));assert.ok(reply.headers.getSetCookie().every(x=>/max-age=0/i.test(x)));}
  }
  const publicCache=createSharedCache();
  const publicLoad=()=>fixture.request("/cache-public");
  assert.equal((await publicCache.request("control",publicLoad)).hit,false);
  assert.equal((await publicCache.request("control",publicLoad)).hit,true);
  // Weaken only a copied response, never the real policy. Prove the isolation assertion detects replay.
  const unsafe=createSharedCache();
  const weaken=async account=>{const reply=await fixture.request("/api/cache-check",account.jar);reply.headers.set("Netlify-CDN-Cache-Control","public, max-age=600");return reply;};
  await unsafe.request("same",()=>weaken(A));const replay=await unsafe.request("same",()=>weaken(B));
  assert.equal(replay.hit,true);assert.throws(()=>assert.ok(replay.reply.body.includes(B.entry.id)),assert.AssertionError);
  const manifest=JSON.parse(await readFile(path.join(fixture.directory,".next/prerender-manifest.json"),"utf8"));
  for(const route of Object.keys(manifest.routes))assert.ok(!route.startsWith("/dashboard")&&route!=='/login'&&route!=='/');
  const login=await fixture.request('/login');policy(login);assert.equal(login.headers.getSetCookie().length,0);
  const health=await fixture.request("/api/health");assert.equal(health.status,200);assert.equal(health.headers.get("cdn-cache-control"),null);
  const asset=login.body.match(/(?:src|href)="([^"?]*\/_next\/static\/[^"?]+\.js)/)?.[1];assert.ok(asset);
  const before=fixture.backend.calls.length;const staticReply=await fixture.request(asset,A.jar);assert.match(staticReply.headers.get("cache-control"),/public.*immutable/);assert.equal(fixture.backend.calls.length,before);assert.equal(staticReply.headers.getSetCookie().length,0);
  async function scan(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())await scan(file);else fixture.clean(await readFile(file,"utf8"));}}
  await scan(path.join(fixture.directory,".next/static"));fixture.clean(fixture.output);assert.deepEqual(fixture.backend.unexpected,[]);
  console.log("PASS: identical HTML/RSC/prefetch/JSON URLs isolate A/B/anonymous; fresh revocation/outages; public hit and unsafe replay controls; dynamic/static boundaries");
  if(process.argv.includes("--browser")){
    console.log("Browser fixture: "+fixture.origin+"/fixture-controls");
    await new Promise(resolve=>{process.once("SIGTERM",resolve);process.once("SIGINT",resolve);});
  }
}finally{await fixture.close();}
