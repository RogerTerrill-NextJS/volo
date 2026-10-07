import assert from "node:assert/strict";
import {request as httpRequest} from "node:http";
import {readFile,readdir} from "node:fs/promises";
import path from "node:path";
import {createRequire} from "node:module";
import {startMutationFixture} from "../tests/helpers/mutation-fixture.mjs";

const withActions=process.argv.includes("--actions");
const fixture=await startMutationFixture({actions:withActions});
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
  await denied(()=>post(member,{value:"truthy-resource"}),403,"forbidden");
  for(const query of ["empty-policy","invalid-role","missing-permission"])await denied(()=>post(member,{value:"valid"},{},"/api/write?"+query),500,"internal_error");
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
  if(withActions){
    const {encodeReply}=createRequire(import.meta.url)("next/dist/compiled/react-server-dom-webpack/client.node.js");
    const html=(await fixture.request("/")).body;
    const decode=value=>value.replaceAll("&quot;",'"').replaceAll("&#x27;","'").replaceAll("&lt;","<").replaceAll("&gt;",">").replaceAll("&amp;","&");
    const forms=[...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(match=>[...match[1].matchAll(/<input\b[^>]*>/g)].flatMap(input=>{
      const name=input[0].match(/name="(\$ACTION_[^"]+)"/)?.[1];return name?[[decode(name),decode(input[0].match(/value="([^"]*)"/)?.[1]??"")]]:[];
    }));
    const ids=forms.map(entries=>JSON.parse(entries.find(([key])=>key.endsWith(":0"))[1]).id);
    assert.equal(ids.length,3,"Discover compiled member, admin and bare form action IDs");
    const form=(entries={value:"valid"})=>{const data=new FormData();for(const [key,value] of Object.entries(entries))data.set(key,value);return data;};
    const invoke=async(transport,account,formData,headers={},index=0)=>{
      let body,requestHeaders=headers;
      if(transport==="fetch"){body=await encodeReply([null,formData]);requestHeaders={Accept:"text/x-component","Next-Action":ids[index],...headers};}
      else {body=new FormData();for(const [key,value] of forms[index])body.append(key,value);for(const [key,value] of formData)body.append(key,value);}
      return fixture.request("/",account.jar,{method:"POST",body,headers:requestHeaders});
    };
    for(const transport of ["fetch","native"]){const before=fixture.effects.length;const result=await invoke(transport,member,form());assert.equal(result.response.status,200,result.body);assert.equal(fixture.effects.length,before+1);if(transport==="fetch")assert.match(result.body,/"ok":true/);}
    console.log("PASS: fetched and native Server Actions invoke the guarded effect once");
    const actionDenied=async(transport,account,data,headers={},code="forbidden",index=0)=>{
      const before=fixture.effects.length;const result=await invoke(transport,account,data,headers,index);assert.equal(fixture.effects.length,before);
      assert.doesNotMatch(result.body,/"ok":true|"saved":true/);
      if(result.response.status===200){assert.ok(decode(result.body).includes('"code":"'+code+'"'),result.body);assert.match(result.response.headers.get("cache-control"),/no-store/);assert.equal(result.response.headers.get("access-control-allow-origin"),null);}
      return result;
    };
    const disabled=await fixture.seed("action-disabled",{status:"disabled"}),absent=await fixture.seed("action-absent",{membership:"absent"}),revoked=await fixture.seed("action-revoked",{auth:"rejected"});
    for(const transport of ["fetch","native"]){
      for(const account of [{jar:new Map()},malformed,forged,revoked])await actionDenied(transport,account,form(),{},"unauthenticated");
      for(const account of [disabled,absent])await actionDenied(transport,account,form());
      await actionDenied(transport,member,form(),{},"forbidden",1);
      await actionDenied(transport,member,form({value:"forbidden-resource"}));
      await actionDenied(transport,member,form({value:"truthy-resource"}));
      await actionDenied(transport,member,form({value:"valid",role:"admin"}),{},"invalid_input");
      let before=fixture.effects.length;let result=await invoke(transport,admin,form(),{},1);assert.equal(result.response.status,200);assert.equal(fixture.effects.length,before+1);assert.equal(fixture.effects.at(-1).userId,admin.entry.id);
      member.entry.status="disabled";await actionDenied(transport,member,form());member.entry.status="active";
      before=fixture.effects.length;await invoke(transport,member,form());assert.equal(fixture.effects.length,before+1);
      for(const Origin of [null,"null","invalid","https://evil.invalid","https://deploy-preview-999--voloapp.netlify.app",fixture.origin+"/",fixture.origin+"?x=1",fixture.origin+", "+fixture.origin])await actionDenied(transport,member,form(),{Origin});
      await actionDenied(transport,member,form(),{Origin:"https://evil.invalid","X-Forwarded-Host":"evil.invalid"});
      for(const site of ["cross-site","same-site"])await actionDenied(transport,member,form(),{"Sec-Fetch-Site":site});
      for(const service of ["auth","membership"]){member.entry[service]="down";await actionDenied(transport,member,form(),{},"unavailable");member.entry[service]=undefined;}
      const duplicate=form();duplicate.append("value","duplicate");await actionDenied(transport,member,duplicate,{},"invalid_input");
      const file=form();file.set("value",new File(["fixture file"],"fixture.txt"));await actionDenied(transport,member,file,{},"invalid_input");
      for(const data of [form({value:""}),form({value:"valid",extra:"unexpected"})])await actionDenied(transport,member,data,{},"invalid_input");
      // UTF-8 field name plus value is exactly 16 KiB, then one byte over.
      before=fixture.effects.length;await invoke(transport,member,form({value:"a".repeat(16379)}));assert.equal(fixture.effects.length,before+1);
      await actionDenied(transport,member,form({value:"a".repeat(16380)}),{},"too_large");
      await actionDenied(transport,member,form({value:"é".repeat(8190)}),{},"too_large");
      await actionDenied(transport,member,form({value:"a".repeat(70000)}),{},"too_large");
      for(const mode of ["parse-throw","authorize-throw","effect-throw"])await actionDenied(transport,member,form({value:"valid",mode}),{},"internal_error");
      before=fixture.effects.length;result=await invoke(transport,member,form({value:"valid",mode:"partial-throw"}));assert.equal(fixture.effects.length,before+1);assert.doesNotMatch(result.body,/"ok":true/);
      // Framework-only control action characterizes Next's native origin policy.
      let bareBefore=fixture.bare.length;await invoke(transport,member,form(),{Origin:"https://evil.invalid"},2);assert.equal(fixture.bare.length,bareBefore);
      await invoke(transport,member,form(),{Origin:null},2);assert.equal(fixture.bare.length,bareBefore+1);
      bareBefore=fixture.bare.length;await invoke(transport,member,form(),{Origin:"https://evil.invalid","X-Forwarded-Host":"evil.invalid"},2);assert.equal(fixture.bare.length,bareBefore+1);
    }
    const beforeWrongMethod=fixture.effects.length;await fixture.request("/",member.jar,{method:"GET",headers:{"Next-Action":ids[0]}});assert.equal(fixture.effects.length,beforeWrongMethod);
    const malformedAction=await fixture.request("/",member.jar,{method:"POST",headers:{"Next-Action":ids[0],"Content-Type":"text/plain"},body:"malformed-payload"});assert.ok(malformedAction.response.status>=400);assert.equal(fixture.effects.length,beforeWrongMethod);
    const beforeConcurrent=fixture.effects.length;await Promise.all([invoke("fetch",member,form()),invoke("native",admin,form())]);assert.equal(fixture.effects.length,beforeConcurrent+2);assert.deepEqual(new Set(fixture.effects.slice(-2).map(x=>x.userId)),new Set([member.entry.id,admin.entry.id]));
    fixture.clean(fixture.output);assert.deepEqual(fixture.backend.unexpected,[]);
    console.log("PASS: both Action transports reject identity/membership/resource/origin/input failures with zero effects; Next origin controls characterized");
  }
}catch(error){fixture.clean(fixture.output);console.error(fixture.output.slice(-6000));throw error;}
finally{await fixture.close();}
