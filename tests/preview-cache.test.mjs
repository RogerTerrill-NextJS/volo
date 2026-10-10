import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import test from "node:test";

async function report(status){
  const source=`globalThis.fetch=async input=>{
    const route=new URL(input).pathname,privatePath=route==='/dashboard';
    const headers={'Cache-Control':privatePath||route==='/login'?'private, no-store':'public, max-age=600, immutable'};
    if(privatePath && ${JSON.stringify(status)}!==null)headers['Cache-Status']=${JSON.stringify(status)};
    return new Response(route==='/'?'<script src="/_next/static/control.js"></script>':'safe',{headers});
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
