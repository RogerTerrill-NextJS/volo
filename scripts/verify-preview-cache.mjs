import assert from "node:assert/strict";
import {createHash} from "node:crypto";

const target=new URL(process.env.SMOKE_BASE_URL??"invalid");
assert.equal(target.protocol,"https:");
assert.equal(target.username+target.password+target.search+target.hash,"");
assert.equal(target.pathname,"/");
const origin=target.origin;
const fields=["cache-control","cdn-cache-control","netlify-cdn-cache-control","cache-status","age"];
let inconclusive=0,publicHits=0;
const observations=[],failures=[];
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
      // Netlify documents the non-RFC token stored=true. Treat explicit true
      // conservatively as a failure, never use false tokens to certify safety.
      if(["?1","true"].includes(params.get(key)))return key;
      if(params.has(key) && params.get(key)!=="?0")uncertain=true;
    }
    const forwarding=["bypass","method","uri-miss","vary-miss","miss","stale","partial","request"];
    if(!forwarding.includes(params.get("fwd")) || (params.get("fwd")!=="bypass" && params.get("stored")!=="?0"))uncertain=true;
  }
  return uncertain?"inconclusive":"not-stored";
}
function verify(check,kind,issues){
  try{check();}catch{issues.push(kind);}
}
async function request(route,headers={},method="GET",privatePath=false){
  for(let hop=0;hop<3;hop++){
    const observedAt=new Date().toISOString(),started=performance.now(),issues=[];
    let response,body;
    try{
      response=await fetch(origin+route,{method,headers,redirect:"manual",signal:AbortSignal.timeout(15000)});
      body=await response.text();
    }catch{
      const report={method,route,observedAt,elapsedMs:Math.round(performance.now()-started),issues:["transport-failure"]};
      observations.push(report);failures.push(report);console.log(JSON.stringify(report));return null;
    }
    const report={method,route,status:response.status,cookies:response.headers.getSetCookie().length,observedAt,elapsedMs:Math.round(performance.now()-started),requestId:response.headers.get("x-nf-request-id"),bodySha256:createHash("sha256").update(body).digest("hex"),...Object.fromEntries(fields.map(field=>[field,response.headers.get(field)])),issues};
    verify(()=>{
      assert.equal(report.cookies,0);
      assert.doesNotMatch(body,/Workspace overview|subject:|access_token|refresh_token/);
    },"unexpected-content-or-cookie",issues);
    if(privatePath){
      verify(()=>{
        assert.match(response.headers.get("cache-control")??"",/no-store/);
        if(new URL(route,origin).pathname==='/login')assert.match(response.headers.get("cache-control")??"",/private.*no-store/);
        for(const field of ["cdn-cache-control","netlify-cdn-cache-control"]){const value=response.headers.get(field);if(value!==null)assert.equal(value,"no-store");}
      },"policy-failure",issues);
      const evidence=storageEvidence(response.headers.get("cache-status"));
      if(["hit","stored"].includes(evidence))issues.push("cdn-"+(evidence==="stored"?"storage":"hit"));
      if(evidence==="inconclusive")inconclusive++;
      // Preserve the existing strict gate until the provider explains the traces.
      // Age anomalies are not labeled as proof of a cache hit or storage.
      verify(()=>assert.ok(Number(response.headers.get("age")??0)===0),"age-anomaly",issues);
      verify(()=>{
        if(new URL(route,origin).pathname==='/login')assert.equal(response.status,200);
        else assert.ok([200,303,307,308].includes(response.status));
      },"unexpected-status",issues);
    }else{
      verify(()=>assert.equal(response.status,200),"unexpected-status",issues);
      verify(()=>{
        assert.doesNotMatch(response.headers.get('cache-control')??'',/private|no-store/);
        if(route.includes('/_next/static/'))assert.match(response.headers.get('cache-control')??'',/public.*immutable/);
      },"public-control-policy",issues);
      if(storageEvidence(response.headers.get('cache-status'))==='hit')publicHits++;
    }
    let negotiated;
    if(headers.RSC && response.status===307){
      verify(()=>{
        const next=new URL(response.headers.get("location"),origin);assert.equal(next.origin,origin);
        if(next.pathname===new URL(route,origin).pathname && next.searchParams.has("_rsc"))negotiated=next.pathname+next.search;
      },"invalid-rsc-negotiation",issues);
    }
    if(!negotiated){
      verify(()=>{
        if(privatePath && response.headers.has("location"))assert.equal(new URL(response.headers.get("location"),origin).href,origin+"/login?reason=authentication-required");
        if(new URL(route,origin).pathname==='/'){
          if(headers['Next-Router-Prefetch']&&response.status===200&&!body.includes('NEXT_REDIRECT'))return;
          if(headers.RSC&&response.status===200)assert.ok(body.includes('NEXT_REDIRECT;replace;/login?reason=authentication-required;307;'));
          else {assert.equal(response.status,307);assert.equal(new URL(response.headers.get('location'),origin).href,origin+'/login?reason=authentication-required');}
        }
      },"unexpected-private-destination",issues);
    }else if(hop===2)issues.push("rsc-negotiation-limit");
    observations.push(report);if(issues.length)failures.push(report);console.log(JSON.stringify(report));
    if(negotiated){route=negotiated;continue;}
    return {response,body};
  }
  return null;
}
const login=await request('/login',{},'GET',true);
const asset=login?.body.match(/(?:src|href)="([^"?]*\/_next\/static\/[^"?]+\.js)/)?.[1];
if(!asset)failures.push({issues:['missing-static-control']});
for(let repeat=0;repeat<3;repeat++){
  for(const route of ['/','/?next=https://foreign.invalid&token=homepage-query-canary','/dashboard']){
    for(const headers of [{},{RSC:'1'},{RSC:'1','Next-Router-Prefetch':'1'}])await request(route,headers,'GET',true);
    await request(route,{},'HEAD',true);
  }
  await request('/login',{},'GET',true);
  for(const route of ['/api/health',...(asset?[asset]:[])])await request(route);
}
const summary={origin,requests:observations.length,failedResponses:failures.length,categories:[...new Set(failures.flatMap(row=>row.issues))],inconclusiveResponses:inconclusive,publicHits};
console.log('SUMMARY: '+JSON.stringify(summary));
if(failures.length){
  console.log('FAIL: strict preview gate unresolved; see categorized observations. Age anomalies require investigation and do not by themselves establish hit/storage. Non-storage remains INCONCLUSIVE when evidence is missing.');
  process.exitCode=1;
}else if(inconclusive||!publicHits){
  console.log(`INCONCLUSIVE: policy checks passed, but ${inconclusive} protected responses lack affirmative CDN bypass/non-storage evidence; public/static hit controls observed: ${publicHits}. Missing Cache-Status or fwd=miss alone cannot certify non-storage.`);
  process.exitCode=2;
}else console.log("PASS: repeated anonymous protected responses enforce no-store with affirmative CDN bypass/non-storage evidence; public/static controls include a reported hit. Authenticated hosted isolation remains deferred.");
