import assert from "node:assert/strict";

const target=new URL(process.env.SMOKE_BASE_URL??"invalid");
assert.equal(target.protocol,"https:");
assert.equal(target.username+target.password+target.search+target.hash,"");
assert.equal(target.pathname,"/");
const origin=target.origin;
const fields=["cache-control","cdn-cache-control","netlify-cdn-cache-control","cache-status","age"];
async function request(route,headers={},method="GET",privatePath=false){
  for(let hop=0;hop<3;hop++){
    const response=await fetch(origin+route,{method,headers,redirect:"manual",signal:AbortSignal.timeout(15000)});
    const body=await response.text();
    assert.equal(response.headers.getSetCookie().length,0);
    assert.doesNotMatch(body,/Workspace overview|subject:|access_token|refresh_token/);
    const report={method,route,status:response.status,cookies:0,...Object.fromEntries(fields.map(field=>[field,response.headers.get(field)]))};
    console.log(JSON.stringify(report));
    if(privatePath){
      assert.match(response.headers.get("cache-control")??"",/no-store/);
      for(const field of ["cdn-cache-control","netlify-cdn-cache-control"]){const value=response.headers.get(field);if(value!==null)assert.equal(value,"no-store");}
      assert.doesNotMatch(response.headers.get("cache-status")??"",/(?:^|[;,\s])hit(?:[;,\s]|$)/i);
      assert.ok(Number(response.headers.get("age")??0)===0,"Protected output must not report positive shared-cache age");
      assert.ok([200,303,307,308].includes(response.status));
    }else assert.equal(response.status,200);
    if(headers.RSC && response.status===307){
      const next=new URL(response.headers.get("location"),origin);assert.equal(next.origin,origin);
      if(next.pathname==="/dashboard" && next.searchParams.has("_rsc")){route=next.pathname+next.search;continue;}
    }
    if(privatePath && response.headers.has("location"))assert.equal(new URL(response.headers.get("location"),origin).href,origin+"/login?reason=authentication-required");
    return {response,body};
  }
  assert.fail("RSC negotiation did not settle");
}
const home=await request("/");
const asset=home.body.match(/(?:src|href)="([^"?]*\/_next\/static\/[^"?]+\.js)/)?.[1];assert.ok(asset);
for(let repeat=0;repeat<3;repeat++){
  for(const headers of [{},{RSC:"1"},{RSC:"1","Next-Router-Prefetch":"1"}])await request("/dashboard",headers,"GET",true);
  await request("/dashboard",{},"HEAD",true);
  for(const route of ["/","/login",asset]){
    const {response}=await request(route);
    assert.doesNotMatch(response.headers.get("cache-control")??"",/private|no-store/);
    if(route===asset)assert.match(response.headers.get("cache-control")??"",/public.*immutable/);
  }
}
console.log("PASS: repeated anonymous protected responses enforce no-store without shared hits/age; public/static controls remain cacheable. Authenticated hosted isolation remains deferred.");
