import assert from "node:assert/strict";
import {request as httpRequest} from "node:http";
import {readFile,readdir} from "node:fs/promises";
import path from "node:path";
import {startMutationFixture} from "../tests/helpers/mutation-fixture.mjs";

const fixture=await startMutationFixture();
try {
  const member=await fixture.seed("member"),admin=await fixture.seed("admin",{role:"admin"});
  const post=(account=member,body={value:"valid"},headers={},route="/api/write")=>fixture.request(route,account.jar,{method:"POST",body:JSON.stringify(body),headers:{"Content-Type":"application/json",...headers}});
  const privateResponse=({response})=>{assert.match(response.headers.get("cache-control"),/private/);assert.match(response.headers.get("cache-control"),/no-store/);assert.equal(response.headers.get("access-control-allow-origin"),null);};
  const denied=async(call,status,code)=>{const before=fixture.effects.length;const result=await call();assert.equal(result.response.status,status,result.body);assert.equal(JSON.parse(result.body).code,code);assert.equal(fixture.effects.length,before);privateResponse(result);return result;};
  const success=async(account,route="/api/write")=>{const before=fixture.effects.length;const queries=fixture.backend.calls.filter(x=>x.service==="membership").length;
    const result=await post(account,{value:"valid"},{},route);assert.equal(result.response.status,200,result.body);assert.deepEqual(JSON.parse(result.body),{ok:true,data:{saved:true}});
    assert.equal(fixture.effects.length,before+1);assert.equal(fixture.effects.at(-1).userId,account.entry.id);assert.equal(fixture.backend.calls.filter(x=>x.service==="membership").length,queries+1);privateResponse(result);};
  await success(member);await success(admin,"/api/write?admin");
  await denied(()=>post({jar:new Map()}),401,"unauthenticated");
  const malformed={jar:new Map([["sb-127-auth-token","invalid-json"]])};
  const forged={jar:new Map(member.jar)};const [name,value]=[...forged.jar][0];const session=JSON.parse(Buffer.from(value.slice(7),"base64url"));session.access_token+="forged";
  forged.jar.set(name,"base64-"+Buffer.from(JSON.stringify(session)).toString("base64url"));
  for(const account of [malformed,forged,await fixture.seed("revoked",{auth:"rejected"})])await denied(()=>post(account),401,"unauthenticated");
  for(const [label,options] of [["disabled",{status:"disabled"}],["absent",{membership:"absent"}]]){const account=await fixture.seed(label,options);await denied(()=>post(account),403,"forbidden");}
  await denied(()=>post(member,{value:"valid"},{},"/api/write?admin"),403,"forbidden");
  await denied(()=>post(member,{value:"forbidden-resource"}),403,"forbidden");
  await denied(()=>post(member,{value:"valid",role:"admin"}),400,"invalid_input");
  member.entry.status="disabled";await denied(()=>post(),403,"forbidden");member.entry.status="active";await success(member);
  for(const key of ["auth","membership"]){member.entry[key]="down";
    await denied(()=>post(member,{value:"valid"},{},"/api/no-proxy-write"),503,"unavailable");
    if(key==="auth"){const before=fixture.effects.length;const proxyFailure=await post();assert.equal(proxyFailure.response.status,503);assert.equal(proxyFailure.body,"Authentication service unavailable.");assert.equal(fixture.effects.length,before);privateResponse(proxyFailure);}
    member.entry[key]=undefined;}
  console.log("PASS: direct member/admin writes, denied identity/roles/resources, fresh revocation and outages");
  for(const Origin of [null,"null","invalid","https://evil.invalid","https://deploy-preview-999--voloapp.netlify.app",fixture.origin+"/",fixture.origin+"?x=1",fixture.origin+", "+fixture.origin,fixture.origin.replace("http:","https:"),fixture.origin.replace(/:\d+$/,":1")]) {
    const authCalls=fixture.backend.calls.length;await denied(()=>post(member,{value:"valid"},{Origin,"X-Forwarded-Host":"evil.invalid",Host:"evil.invalid"},"/api/no-proxy-write"),403,"forbidden");
    assert.equal(fixture.backend.calls.length,authCalls,"Origin rejects before Auth");
  }
  for(const site of ["cross-site","same-site","invalid"])await denied(()=>post(member,{value:"valid"},{"Sec-Fetch-Site":site}),403,"forbidden");
  for(const method of ["GET","HEAD","OPTIONS","PUT","PATCH","DELETE"]){const before=fixture.effects.length;const result=await fixture.request("/api/write",member.jar,{method});assert.equal(result.response.status,405);assert.equal(result.response.headers.get("allow"),"POST");assert.equal(fixture.effects.length,before);privateResponse(result);}
  await denied(()=>post(member,{value:"valid"},{"Content-Type":"text/plain"}),415,"unsupported_media_type");
  await denied(()=>fixture.request("/api/write",member.jar,{method:"POST",headers:{"Content-Type":"application/json"},body:"{"}),400,"invalid_input");
  for(const body of [null,[],{}, {value:1},{value:""}])await denied(()=>post(member,body),400,"invalid_input");
  await denied(()=>post(member,{value:"x".repeat(17000)}),413,"too_large");
  for(const mode of ["parse-throw","authorize-throw","effect-throw"])await denied(()=>post(member,{value:"valid",mode}),500,"internal_error");
  const beforePartial=fixture.effects.length;const partial=await post(member,{value:"valid",mode:"partial-throw"});assert.equal(partial.response.status,500);assert.equal(fixture.effects.length,beforePartial+1);
  const beforeParallel=fixture.effects.length;await Promise.all([post(member),post(admin)]);assert.equal(fixture.effects.length,beforeParallel+2);assert.deepEqual(new Set(fixture.effects.slice(-2).map(x=>x.userId)),new Set([member.entry.id,admin.entry.id]));
  const raw=async({body,headers={},stall=false})=>new Promise((resolve,reject)=>{
    const req=httpRequest(fixture.origin+"/api/no-proxy-write",{method:"POST",headers:{Origin:fixture.origin,Cookie:[...member.jar].map(([k,v])=>`${k}=${v}`).join("; "),"Content-Type":"application/json",...headers}},res=>{let text="";res.on("data",chunk=>text+=chunk);res.on("end",()=>{req.destroy();resolve({status:res.statusCode,body:text});});});
    req.on("error",reject);req.setTimeout(8000,()=>req.destroy(new Error("Fixture HTTP timeout")));if(stall)req.write("{");else req.end(body);
  });
  for(const input of [{body:'"'+"x".repeat(17000)+'"'},{stall:true}]){const before=fixture.effects.length;const result=await raw(input);assert.equal(result.status,input.stall?400:413);assert.equal(fixture.effects.length,before);fixture.clean(result.body);}
  const beforeFraming=fixture.effects.length;const framing=await raw({body:'{"value":"'+"x".repeat(17000)+'"}',headers:{"Content-Length":"2"}});assert.equal(framing.status,400);assert.equal(fixture.effects.length,beforeFraming);
  console.log("PASS: origin/forwarding/method/media/schema/stream limits and exception no-retry policy");
  await fixture.start({VOLO_MUTATION_ORIGIN:"https://runtime-override.invalid"});await success(member);
  await denied(()=>post(member,{value:"valid"},{Origin:"https://runtime-override.invalid"}),403,"forbidden");
  async function scan(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())await scan(file);else fixture.clean(await readFile(file,"utf8"));}}
  await scan(path.join(fixture.directory,".next/static"));fixture.clean(fixture.output);assert.deepEqual(fixture.backend.unexpected,[]);
  console.log("PASS: build-pinned origin, concurrent callers, browser/output credential boundaries");
}finally{await fixture.close();}
