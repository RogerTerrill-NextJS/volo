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
  for(const route of Object.keys(manifest.routes))assert.ok(!route.startsWith("/dashboard")&&route!=='/login');
  const login=await fixture.request('/login');policy(login);assert.equal(login.headers.getSetCookie().length,0);
  for(const route of ["/"]){const reply=await fixture.request(route);assert.doesNotMatch(reply.headers.get("cache-control")??"",/private|no-store/);assert.equal(reply.headers.get("cdn-cache-control"),null);}
  const home=await fixture.request("/");const asset=home.body.match(/(?:src|href)="([^"?]*\/_next\/static\/[^"?]+\.js)/)?.[1];assert.ok(asset);
  const before=fixture.backend.calls.length;const staticReply=await fixture.request(asset,A.jar);assert.match(staticReply.headers.get("cache-control"),/public.*immutable/);assert.equal(fixture.backend.calls.length,before);assert.equal(staticReply.headers.getSetCookie().length,0);
  async function scan(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())await scan(file);else fixture.clean(await readFile(file,"utf8"));}}
  await scan(path.join(fixture.directory,".next/static"));fixture.clean(fixture.output);assert.deepEqual(fixture.backend.unexpected,[]);
  console.log("PASS: identical HTML/RSC/prefetch/JSON URLs isolate A/B/anonymous; fresh revocation/outages; public hit and unsafe replay controls; dynamic/static boundaries");
  if(process.argv.includes("--browser")){
    console.log("Browser fixture: "+fixture.origin+"/fixture-controls");
    await new Promise(resolve=>{process.once("SIGTERM",resolve);process.once("SIGINT",resolve);});
  }
}finally{await fixture.close();}
