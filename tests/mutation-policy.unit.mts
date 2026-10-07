import assert from "node:assert/strict";
import {test} from "node:test";
import {checkMutationOrigin} from "../lib/auth/mutation-request.ts";
import {readMutationJson,readMutationForm} from "../lib/auth/mutation-input.ts";

const origin="https://voloapp.netlify.app";
test("origin evidence cannot be replaced by host headers",()=>{
  for(const value of [undefined,"null","https://evil.invalid",origin+"/",origin+"?x=1",origin+"#x",origin+", "+origin,"https://user:pass@voloapp.netlify.app","http://voloapp.netlify.app",origin+":444","https://deploy-preview-19--voloapp.netlify.app","not-url"]) {
    const headers=new Headers({Host:"evil.invalid","X-Forwarded-Host":"evil.invalid",Referer:origin});
    if(value!==undefined)headers.set("Origin",value);
    assert.equal(checkMutationOrigin(headers,origin),"forbidden",String(value));
  }
  for(const site of [undefined,"same-origin","none"]) {
    const headers=new Headers({Origin:origin});if(site)headers.set("Sec-Fetch-Site",site);
    assert.equal(checkMutationOrigin(headers,origin),null);
  }
  for(const site of ["cross-site","same-site","unexpected"])assert.equal(checkMutationOrigin(new Headers({Origin:origin,"Sec-Fetch-Site":site}),origin),"forbidden");
  assert.equal(checkMutationOrigin(new Headers({Origin:origin}),""),"unavailable");
  assert.equal(checkMutationOrigin(new Headers({Origin:origin}),"invalid"),"unavailable");
  assert.equal(checkMutationOrigin(new Headers({Origin:"http://127.0.0.1:3000"}),"http://127.0.0.1:3000"),null);
  assert.equal(checkMutationOrigin(new Headers({Origin:"http://127.0.0.1:3001"}),"http://127.0.0.1:3000"),"forbidden");
});
const json=(body:BodyInit|null,headers:HeadersInit={"Content-Type":"application/json"})=>new Request("http://localhost/api/write",{method:"POST",body,headers,duplex:"half"} as RequestInit);
test("JSON reads bound actual bytes, media, decoding and configuration",async()=>{
  assert.deepEqual(await readMutationJson(json('{"value":1}')),{value:1});
  assert.equal(await readMutationJson(json('"'+"a".repeat(16382)+'"',{"Content-Type":"application/json; charset=utf-8"})),"a".repeat(16382));
  for(const text of ['"'+"a".repeat(16383)+'"','"'+"é".repeat(8192)+'"'])await assert.rejects(readMutationJson(json(text)),{code:"too_large"});
  for(const type of ["text/plain","application/json; charset=latin1","application/json; other=x",""])await assert.rejects(readMutationJson(json("{}",{"Content-Type":type})),{code:"unsupported_media_type"});
  for(const text of ["","{","null extra"])await assert.rejects(readMutationJson(json(text)),{code:"invalid_input"});
  await assert.rejects(readMutationJson(json(new Uint8Array([0x22,0xff,0x22]))),{code:"invalid_input"});
  await assert.rejects(readMutationJson(json("{}",{"Content-Type":"application/json","Content-Length":"999999"})),{code:"too_large"});
  await assert.rejects(readMutationJson(json('"'+"a".repeat(16383)+'"',{"Content-Type":"application/json","Content-Length":"2"})),{code:"too_large"});
  for(const limit of [0,-1,65537,NaN,1.5])await assert.rejects(readMutationJson(json("{}"),limit));
  let cancelled=false;
  const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(16385));},cancel(){cancelled=true;}});
  await assert.rejects(readMutationJson(json(stream)),{code:"too_large"});assert.equal(cancelled,true);
  const broken=new ReadableStream({start(controller){controller.error(new Error("input-error-canary"));}});
  await assert.rejects(readMutationJson(json(broken)),{code:"invalid_input",message:"Invalid input."});
});
test("stalled JSON read times out and cancels the reader",async()=>{
  let cancelled=false;const start=Date.now();
  const stream=new ReadableStream({cancel(){cancelled=true;}});
  await assert.rejects(readMutationJson(json(stream)),{code:"invalid_input"});
  assert.ok(Date.now()-start>=4900 && Date.now()-start<7000);assert.equal(cancelled,true);
});
test("FormData admits only bounded unique text fields",()=>{
  const form=new FormData();form.set("value","a".repeat(16379));
  assert.equal(readMutationForm(form).value.length,16379);
  form.set("value","a".repeat(16380));assert.throws(()=>readMutationForm(form),{code:"too_large"});
  form.set("value","é".repeat(8190));assert.throws(()=>readMutationForm(form),{code:"too_large"});
  const duplicate=new FormData();duplicate.append("value","1");duplicate.append("value","2");assert.throws(()=>readMutationForm(duplicate),{code:"invalid_input"});
  const file=new FormData();file.set("value",new File(["x"],"x.txt"));assert.throws(()=>readMutationForm(file),{code:"invalid_input"});
  const metadata=new FormData();metadata.set("$ACTION_ID_test","");metadata.set("value","ok");
  assert.deepEqual({...readMutationForm(metadata)},{value:"ok"});
  metadata.set("$ACTION_ID_test","x".repeat(16384));assert.throws(()=>readMutationForm(metadata),{code:"too_large"});
  const proto=new FormData();proto.set("__proto__","x");assert.equal(Object.hasOwn(readMutationForm(proto),"__proto__"),true);
});
