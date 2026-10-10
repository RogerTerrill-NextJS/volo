import assert from "node:assert/strict";

const target=new URL(process.env.SMOKE_BASE_URL??"invalid");
assert.equal(target.protocol,"https:");
assert.equal(target.username+target.password+target.search+target.hash,"");
assert.equal(target.pathname,"/");
const origin=target.origin;
const fields=["cache-control","cdn-cache-control","netlify-cdn-cache-control","cache-status","age"];
let inconclusive=0;
// Supported RFC 9211 evidence only; unknown/malformed evidence cannot certify storage.
function splitField(value,separator){
  const parts=[];let quoted=false,escaped=false,start=0;
  for(let i=0;i<value.length;i++){
    const char=value[i];
    if(escaped){escaped=false;continue;}
    if(quoted && char==='\\'){escaped=true;continue;}
    if(char==='"')quoted=!quoted;
    else if(!quoted && char===separator){parts.push(value.slice(start,i).trim());start=i+1;}
  }
  return quoted||escaped?null:[...parts,value.slice(start).trim()];
}
function storageEvidence(value){
  const members=splitField(value??"",",");
  if(!members?.length)return "inconclusive";
  let uncertain=false;
  for(const member of members){
    const parts=splitField(member,";");
    if(!parts || !/^(?:[A-Za-z*][A-Za-z0-9!#$%&'*+.^_`|~:/-]*|"(?:[^"\\]|\\["\\])*")$/.test(parts[0])){uncertain=true;continue;}
    const params=new Map();
    for(const part of parts.slice(1)){
      const match=part.match(/^([a-z*][a-z0-9_.*-]*)(?:=(.+))?$/);
      if(!match || params.has(match[1])){uncertain=true;continue;}
      params.set(match[1],match[2]??"?1");
    }
    for(const key of ["hit","stored"]){
      if(params.get(key)==="?1")return key;
      if(params.has(key) && params.get(key)!=="?0")uncertain=true;
    }
    if(params.get("fwd")!=="bypass" && !(params.has("fwd") && params.get("stored")==="?0"))uncertain=true;
  }
  return uncertain?"inconclusive":"not-stored";
}
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
      const evidence=storageEvidence(response.headers.get("cache-status"));
      assert.ok(!["hit","stored"].includes(evidence),"Protected response reports CDN "+evidence);
      if(evidence==="inconclusive")inconclusive++;
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
  const login=await request('/login');assert.match(login.response.headers.get('cache-control')??'',/private.*no-store/);assert.equal(login.response.headers.getSetCookie().length,0);
  for(const route of ["/",asset]){
    const {response}=await request(route);
    assert.doesNotMatch(response.headers.get("cache-control")??"",/private|no-store/);
    if(route===asset)assert.match(response.headers.get("cache-control")??"",/public.*immutable/);
  }
}
if(inconclusive){
  console.log(`INCONCLUSIVE: policy checks passed, but ${inconclusive} protected responses lack affirmative CDN bypass/non-storage evidence. Missing Cache-Status or fwd=miss alone cannot certify non-storage.`);
  process.exitCode=2;
}else console.log("PASS: repeated anonymous protected responses enforce no-store with affirmative CDN bypass/non-storage evidence; public/static controls remain cacheable. Authenticated hosted isolation remains deferred.");
