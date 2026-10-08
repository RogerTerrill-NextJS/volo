import assert from "node:assert/strict";
import {test} from "node:test";
import {createServer} from "node:http";
import {once} from "node:events";

const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const subject="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const other="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const input={invitationId:id,expectedVersion:7,verifiedSubject:subject,verifiedEmail:" Person+tag@Example.COM "};
const row={id,version:7,status:"issued",recipient_email_key:"person+tag@example.com",auth_user_id:subject,verified_user_id:null};

test("invitation eligibility fences identity and version without age-based expiry",async()=>{
  process.env.NEXT_PUBLIC_SUPABASE_URL="https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="sb_publishable_ci_fixture";
  process.env.SUPABASE_SECRET_KEY="sb_secret_invitation_test_fixture";
  const {readInvitationEligibility}=await import("../lib/auth/invitation-eligibility.ts");
  const original=globalThis.fetch;
  let body:unknown=[row];let status=200;let calls=0;
  globalThis.fetch=async (url,init)=>{
    calls++;
    const target=new URL(String(url));
    assert.equal(target.origin,"https://example.supabase.co");
    assert.equal(target.pathname,"/rest/v1/invitations");
    assert.equal(target.searchParams.get("id"),`eq.${id}`);
    assert.equal(init?.cache,"no-store");
    assert.equal(init?.redirect,"error");
    assert.equal(new Headers(init?.headers).get("apikey"),"sb_secret_invitation_test_fixture");
    return Response.json(body,{status});
  };
  try {
    assert.equal(await readInvitationEligibility(input),"eligible");
    for(const state of ["setup_verified","password_established"]){
      body=[{...row,status:state,verified_user_id:subject}];
      assert.equal(await readInvitationEligibility(input),"eligible",state);
      body=[{...row,status:state,verified_user_id:other}];
      assert.equal(await readInvitationEligibility(input),"not_eligible","wrong verified subject");
    }
    for(const change of [{version:8},{auth_user_id:other},{recipient_email_key:"person@example.com"},
      {recipient_email_key:"per.son+tag@example.com"},... ["pending_issuance","revoked","superseded","redeemed"].map(status=>({status}))]){
      body=[{...row,...change}];
      assert.equal(await readInvitationEligibility(input),"not_eligible",JSON.stringify(change));
    }
    body=[];assert.equal(await readInvitationEligibility(input),"not_eligible");
    body=[row];
    for(const change of [{invitationId:"invalid"},{expectedVersion:0},{expectedVersion:Number.MAX_SAFE_INTEGER+1},
      {verifiedSubject:"invalid"},{verifiedEmail:"pérson@example.com"},{verifiedEmail:""},{verifiedEmail:"person@@example.com"}]){
      const before=calls;
      assert.equal(await readInvitationEligibility({...input,...change}),"not_eligible");
      assert.equal(calls,before,"invalid input must not reach the privileged service");
    }
    // Removing unknown-row validation or merging service errors into denial must fail these cases.
    for(const malformed of [null,[null],{},[row,row],[{...row,version:"7"}],[{...row,status:"unknown"}],
      [{...row,recipient_email_key:null}],[{...row,auth_user_id:undefined}],[{...row,id:other}]]){
      body=malformed;assert.equal(await readInvitationEligibility(input),"unavailable");
    }
    body={message:"private-provider-detail"};status=503;
    assert.equal(await readInvitationEligibility(input),"unavailable");
    globalThis.fetch=async()=>{throw new Error("private-provider-detail");};
    assert.equal(await readInvitationEligibility(input),"unavailable");
    delete process.env.SUPABASE_SECRET_KEY;
    assert.equal(await readInvitationEligibility(input),"unavailable");
  } finally {globalThis.fetch=original;delete process.env.SUPABASE_SECRET_KEY;}
});

test("invitation reads bound stalled headers and bodies and never follow redirects",async()=>{
  const {readInvitationEligibility}=await import("../lib/auth/invitation-eligibility.ts");
  const saved={url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.SUPABASE_SECRET_KEY};
  let mode="headers";let calls=0;
  const server=createServer((_request,response)=>{
    calls++;
    if(mode==="headers") return;
    if(mode==="body") {response.writeHead(200,{"content-type":"application/json"});response.write("[");return;}
    response.writeHead(302,{location:"/secret-leak-target"}).end();
  });
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const address=server.address();assert.ok(address && typeof address!=="string");
  process.env.NEXT_PUBLIC_SUPABASE_URL=`http://127.0.0.1:${address.port}`;
  process.env.SUPABASE_SECRET_KEY="sb_secret_invitation_test_fixture";
  try {
    for(mode of ["headers","body"]){
      const start=Date.now();
      assert.equal(await readInvitationEligibility(input),"unavailable",mode);
      assert.ok(Date.now()-start<6500,`${mode} deadline includes the response body`);
    }
    mode="redirect";const before=calls;
    assert.equal(await readInvitationEligibility(input),"unavailable");
    assert.equal(calls,before+1,"no redirect follow or automatic retry");
  } finally {
    if(saved.url===undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=saved.url;
    if(saved.key===undefined) delete process.env.SUPABASE_SECRET_KEY;else process.env.SUPABASE_SECRET_KEY=saved.key;
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
});
