import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import test from "node:test";

async function report(status,{publicHome=false,wrongHome=false,rscRedirect=false,prefetchShell=false,inheritHome=false}={}){
  const source=`globalThis.fetch=async (input,init)=>{
    const route=new URL(input).pathname,privatePath=route==='/dashboard'||route==='/'&&!${JSON.stringify(publicHome)};
    const headers={'Cache-Control':privatePath||route==='/login'?'private, no-store':'public, max-age=600, immutable'};
    if(privatePath && ${JSON.stringify(status)}!==null)headers['Cache-Status']=${JSON.stringify(status)};
    if(route==='/'&&init?.headers?.['Next-Router-Prefetch']&&${JSON.stringify(prefetchShell)})return new Response('prefetch shell',{headers});
    if(route==='/'&&init?.headers?.RSC&&${JSON.stringify(rscRedirect)})return new Response('NEXT_REDIRECT;replace;/login?reason=authentication-required;307;',{headers});
    if(route==='/'&&!${JSON.stringify(publicHome)})headers.Location=${JSON.stringify(wrongHome?'/dashboard':'/login?reason=authentication-required')};
    if(route==='/'&&new URL(input).searchParams.has('token')&&${JSON.stringify(inheritHome)})headers.Location+='&'+new URL(input).searchParams.toString();
    return new Response(route==='/login'||route==='/'?'<script src="/_next/static/control.js"></script>':'safe',{headers,status:route==='/'&&!${JSON.stringify(publicHome)}?307:200});
  };`;
  try{
    const result=await promisify(execFile)(process.execPath,["--import","data:text/javascript,"+encodeURIComponent(source),"scripts/verify-preview-cache.mjs"],{env:{...process.env,SMOKE_BASE_URL:"https://fixture.invalid"}});
    return {code:0,...result};
  }catch(error){return {code:error.code,stdout:error.stdout,stderr:error.stderr};}
}
test("preview gate rejects explicit CDN storage and Boolean hits",async()=>{
  for(const status of ["Netlify; fwd=miss; stored; ttl=600","Netlify; fwd=miss; stored=?1","Netlify; hit=?1",'"Origin cache"; fwd=bypass, "Edge cache"; fwd=miss; stored']){
    const result=await report(status);assert.equal(result.code,1,status);assert.doesNotMatch(result.stdout,/PASS:/);
  }
});
test("preview gate marks missing or miss-only storage evidence inconclusive",async()=>{
  for(const status of [null,"Netlify; fwd=miss",'Netlify; detail="fwd=bypass; stored=?0"']){
    const result=await report(status);assert.equal(result.code,2,status);assert.match(result.stdout,/INCONCLUSIVE:/);assert.doesNotMatch(result.stdout,/PASS:/);
  }
});
test("preview gate accepts affirmative bypass and false stored Booleans",async()=>{
  for(const status of ["Netlify; fwd=bypass","Netlify; fwd=miss; stored=?0; hit=?0",'"Origin; cache"; fwd=bypass, "Edge, cache"; fwd=miss; stored=?0']){
    const result=await report(status);assert.equal(result.code,0,result.stderr);assert.match(result.stdout,/PASS:/);
  }
});

test("preview gate rejects a cacheable homepage or incorrect anonymous destination",async()=>{
 for(const options of [{publicHome:true},{wrongHome:true}]){
  const result=await report('Netlify; fwd=bypass',options);assert.equal(result.code,1);assert.doesNotMatch(result.stdout,/PASS:/);
 }
});

test("preview gate recognizes homepage RSC redirect instructions without a Location header",async()=>{
 const result=await report('Netlify; fwd=bypass',{rscRedirect:true});assert.equal(result.code,0,result.stderr);
});

test("preview gate accepts a private prefetch shell without a redirect or member content",async()=>{
 const result=await report('Netlify; fwd=bypass',{rscRedirect:true,prefetchShell:true});assert.equal(result.code,0,result.stderr);
});

test("preview gate rejects inherited homepage query parameters",async()=>{
 const result=await report('Netlify; fwd=bypass',{inheritHome:true});assert.equal(result.code,1);assert.doesNotMatch(result.stdout,/PASS:/);
});
