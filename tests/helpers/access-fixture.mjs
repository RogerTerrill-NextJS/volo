import {createServer} from "node:http";
import {once} from "node:events";
import {createServerClient} from "@supabase/ssr";

export const accessKey="sb_publishable_access_fixture";
export const accessCanaries=["private-access-error-canary","private-access-metadata-canary","access-fixture-signature","access-fixture-refresh"];
export async function startAccessFixture() {
  const cases=new Map(),tokens=new Map(),calls=[],unexpected=[];
  let sequence=0;
  const encode=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
  const user=id=>({id,aud:"authenticated",role:"authenticated",email:"fictional@example.invalid",
    app_metadata:{},user_metadata:{role:"admin",canary:accessCanaries[1]},created_at:"2026-01-01T00:00:00Z"});
  const session=(entry,expired=false)=>{
    const token=`${encode({alg:"HS256",typ:"JWT"})}.${encode({sub:entry.id,exp:expired?1000000000:4102444800})}.${accessCanaries[2]}`;
    tokens.set(token,entry);
    return {access_token:token,refresh_token:`${accessCanaries[3]}-${entry.label}`,token_type:"bearer",
      expires_in:expired?-60:3600,expires_at:expired?1000000000:4102444800,user:user(entry.cookieId??entry.id)};
  };
  function failure(mode,req,res) {
    if(mode==="socket") {req.socket.destroy();return true;}
    if(mode==="hang") return true;
    if(mode==="body") {res.writeHead(200);res.write("[");return true;}
    if(mode==="malformed") {res.end(accessCanaries[0]);return true;}
    if(["unknown","rejected","rate","down","denied"].includes(mode)) {
      res.writeHead(mode==="rate"?429:mode==="down"?503:mode==="denied"?403:400);
      res.end(JSON.stringify({code:mode==="rejected"?"bad_jwt":"unexpected_failure",message:accessCanaries[0]}));return true;
    }
    return false;
  }
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,"http://fixture.invalid");let body="";
    for await(const chunk of req)body+=chunk;
    res.setHeader("content-type","application/json");res.setHeader("x-supabase-api-version","2024-01-01");
    if(url.pathname==="/auth/v1/token" && url.searchParams.get("grant_type")==="password") {
      const label=JSON.parse(body).email.split("@")[0];const entry=cases.get(label);
      res.end(JSON.stringify(session(entry,entry.expired)));return;
    }
    const token=req.headers.authorization?.replace(/^Bearer /i,"");
    let entry=tokens.get(token);
    if(url.pathname==="/auth/v1/token" && url.searchParams.get("grant_type")==="refresh_token") {
      entry=cases.get(JSON.parse(body).refresh_token.replace(`${accessCanaries[3]}-`,""));
      calls.push({service:"refresh",subject:entry?.id,method:req.method});
      if(failure(entry?.auth,req,res))return;
      res.end(JSON.stringify(session(entry)));return;
    }
    if(url.pathname==="/auth/v1/user") {
      calls.push({service:"auth",subject:entry?.id,method:req.method});
      if(!entry){failure("rejected",req,res);return;}
      if(failure(entry.auth,req,res))return;
      res.end(JSON.stringify(entry.auth==="invalid"?{}:user(entry.verifiedId??entry.id)));return;
    }
    if(url.pathname==="/rest/v1/memberships") {
      calls.push({service:"membership",subject:entry?.id,method:req.method,
        filter:url.searchParams.get("user_id"),select:url.searchParams.get("select")});
      if(!entry){failure("denied",req,res);return;}
      if(failure(entry.membership,req,res))return;
      const row={user_id:entry.rowId??entry.id,role:entry.role,status:entry.status};
      let data=entry.membership==="absent"||url.searchParams.get("user_id")!==`eq.${entry.id}`?[]:[row];
      if(entry.membership==="duplicate")data=[row,row];
      if(entry.membership==="invalid")data={unexpected:true};
      if(entry.membership==="null")data=null;
      if(entry.membership==="null-row")data=[null];
      res.end(JSON.stringify(data));return;
    }
    unexpected.push({method:req.method,path:url.pathname});res.writeHead(418).end("{}");
  });
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const origin=`http://127.0.0.1:${server.address().port}`;
  return {origin,calls,unexpected,cases,async seed(label,options={}) {
    const id=`aaaaaaaa-aaaa-4aaa-8aaa-${String(++sequence).padStart(12,"0")}`;
    const entry={label,id,role:"member",status:"active",...options};cases.set(label,entry);
    const jar=new Map();
    const client=createServerClient(origin,accessKey,{cookies:{getAll:()=>[],setAll:updates=>{
      for(const cookie of updates)if(cookie.options.maxAge!==0)jar.set(cookie.name,cookie.value);
    }}});
    const {error}=await client.auth.signInWithPassword({email:`${label}@example.invalid`,password:"fictional"});
    if(error)throw new Error("Fixture seed failed");
    return {jar,entry};
  },async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
