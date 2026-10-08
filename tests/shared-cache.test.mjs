import assert from "node:assert/strict";
import test from "node:test";
import {createSharedCache} from "./helpers/shared-cache.mjs";

const reply=(headers,body="A",status=200)=>({status,headers:new Headers(headers),body});
test("explicit public control hits and stored replies are independent copies",async()=>{
  const cache=createSharedCache();let loads=0;
  const load=async()=>{loads++;return reply({"Cache-Control":"public, max-age=600"});};
  const first=await cache.request("same",load);
  first.reply.headers.set("Cache-Control","no-store");first.reply.body="changed";
  const second=await cache.request("same",load);
  assert.equal(second.hit,true);assert.equal(second.reply.body,"A");assert.equal(loads,1);
  assert.equal(second.reply.headers.get("cache-control"),"public, max-age=600");
});
test("private directives at each CDN precedence level never store",async()=>{
  for(const field of ["Cache-Control","CDN-Cache-Control","Netlify-CDN-Cache-Control"]){
    for(const policy of ["private, max-age=600","public, no-store, max-age=600","public, no-cache, max-age=600"]){
      const cache=createSharedCache();let loads=0;
      const load=async()=>{loads++;return reply({"Cache-Control":"public, max-age=600",[field]:policy});};
      assert.equal((await cache.request("same",load)).hit,false);
      assert.equal((await cache.request("same",load)).hit,false);
      assert.equal(loads,2);assert.equal(cache.size(),0);
    }
  }
});
test("targeted CDN precedence and conservative TTL/status rules are explicit",async()=>{
  const cache=createSharedCache();
  const load=async()=>reply({"Cache-Control":"private, no-store","CDN-Cache-Control":"no-store","Netlify-CDN-Cache-Control":"public, s-maxage=600"});
  await cache.request("same",load);assert.equal((await cache.request("same",load)).hit,true);
  for(const [policy,status] of [["public",200],["public, max-age=0",200],["public, max-age=600, s-maxage=0",200],["public, max-age=600",303]]){
    const model=createSharedCache();const fetch=async()=>reply({"Cache-Control":policy},"A",status);
    await model.request("same",fetch);assert.equal((await model.request("same",fetch)).hit,false);
  }
});
test("unsafe fixture policy demonstrates detectable cross-subject replay",async()=>{
  const cache=createSharedCache();
  await cache.request("same",async()=>reply({"Netlify-CDN-Cache-Control":"public, max-age=600"},"subject:A"));
  const second=await cache.request("same",async()=>reply({"Netlify-CDN-Cache-Control":"public, max-age=600"},"subject:B"));
  assert.equal(second.hit,true);
  assert.throws(()=>assert.equal(second.reply.body,"subject:B"),assert.AssertionError);
});
