import "next/dist/server/node-environment-baseline.js";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { AUTH_VERIFICATION_TIMEOUT_MS, createProxyAuthTransport } from "../lib/supabase/proxy-auth.ts";
import { refreshSupabaseSession } from "../lib/supabase/proxy.ts";
import { config } from "../proxy.ts";
import { NextRequest, NextResponse } from "next/server.js";
import nextTesting from "next/experimental/testing/server.js";
import { startAuthFixture, seedSession, cookieHeader, fixtureKey } from "./helpers/proxy-auth-fixture.mjs";
const { unstable_doesMiddlewareMatch: unstable_doesProxyMatch } = nextTesting;

test("Proxy matcher covers application requests and excludes exact public assets", () => {
  for (const url of ["/", "/dashboard", "/dashboard/report.csv", "/auth/confirm/child", "/auth/confirm-extra", "/login", "/api/private", "/api/health-extra", "/file.svg/private", "/_next/data/build/dashboard.json"]) {
    for(const headers of [{},{rsc:"1"},{"next-router-prefetch":"1"}])
      assert.equal(unstable_doesProxyMatch({config,nextConfig:{},url,headers}),true,url);
  }
  for (const url of ["/auth/confirm", "/auth/confirm/", "/_next/static/app.js","/_next/image","/api/health","/api/health/","/favicon.ico","/robots.txt","/sitemap.xml","/file.svg","/globe.svg","/next.svg","/vercel.svg","/window.svg"])
    assert.equal(unstable_doesProxyMatch({config,nextConfig:{},url}),false,url);
});

test("real SDK Proxy isolates refreshes, preserves replacements and rejects outages safely", async () => {
  const auth = await startAuthFixture();
  const previous = [process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY];
  process.env.NEXT_PUBLIC_SUPABASE_URL = auth.origin;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = fixtureKey;
  const key = "sb-127-auth-token";
  const request = (jar = new Map<string,string>(), path = "/dashboard") => new NextRequest("https://app.example.invalid"+path,{headers:{cookie:cookieHeader(jar),"x-user-id":"forged-identity"}});
  try {
    const anonymous = await refreshSupabaseSession(request());
    assert.match(anonymous.response.headers.get("cache-control")!, /private/);
    for(const field of ["cdn-cache-control","netlify-cdn-cache-control"]) assert.equal(anonymous.response.headers.get(field),"no-store");
    for(const jar of [new Map<string,string>(),new Map([[key+"-code-verifier","pending"]])]) {
      const publicResult=await refreshSupabaseSession(request(jar,"/"));
      assert.equal(publicResult.response.headers.get("cache-control"),null);
      assert.equal(publicResult.response.headers.get("cdn-cache-control"),null);
    }
    await refreshSupabaseSession(request(new Map([[key+"-code-verifier","pending"]])));
    assert.equal(auth.calls.length,0);
    const jars = await Promise.all([seedSession(auth.origin,"expired-large-a"), seedSession(auth.origin,"expired-b")]);
    const reqs = jars.map(jar=>request(jar));
    const results = await Promise.all(reqs.map(req=>refreshSupabaseSession(req)));
    for (let index=0;index<results.length;index++) {
      const result = results[index];
      assert.equal(result.response.status,200);
      const cookies = result.response.cookies.getAll();
      assert.ok(cookies.some(cookie=>cookie.value && cookie.name===key));
      assert.ok(reqs[index].cookies.get(key));
      assert.equal(result.response.headers.get("cache-control"),"private, no-cache, no-store, must-revalidate, max-age=0");
      const replacement = NextResponse.redirect("https://app.example.invalid/next",303);
      for(const field of ["cache-control","cdn-cache-control","netlify-cdn-cache-control"]) replacement.headers.set(field,"public, s-maxage=600");
      const redirect = result.finalizeResponse(replacement);
      for(const field of ["cdn-cache-control","netlify-cdn-cache-control"]) assert.equal(redirect.headers.get(field),"no-store");
      const json = result.finalizeResponse(NextResponse.json({ok:true},{headers:{"Netlify-CDN-Cache-Control":"public, s-maxage=600"}}));
      assert.equal(json.headers.get("netlify-cdn-cache-control"),"no-store");
      assert.deepEqual(await json.json(),{ok:true});
      assert.deepEqual(json.cookies.getAll().map(c=>({...c,expires:undefined})),cookies.map(c=>({...c,expires:undefined})));
      assert.deepEqual(json.headers.getSetCookie(),result.response.headers.getSetCookie());
      assert.equal(redirect.status,303);
      assert.equal(redirect.headers.get("location"),"https://app.example.invalid/next");
      assert.equal(redirect.headers.get("x-middleware-request-cookie"),null);
      assert.equal(redirect.headers.get("cookie"),null);
      assert.ok(redirect.cookies.getAll().every(cookie=>cookies.some(original=>original.name===cookie.name && original.value===cookie.value)));
      assert.deepEqual(redirect.cookies.getAll().map(c=>({...c,value:undefined,expires:undefined})), cookies.map(c=>({...c,value:undefined,expires:undefined})));
      const broken = NextResponse.next();
      broken.cookies.set = () => {throw new Error("fixture cookie writer failed");};
      assert.throws(()=>result.finalizeResponse(broken),/fixture cookie writer failed/);
    }
    assert.ok(results[0].response.cookies.getAll().filter(c=>c.maxAge===0).length>1);
    for(const id of ["rejected-expired","revoked-fresh"]) {
      const jar = await seedSession(auth.origin,id);
      jar.set(key+"-code-verifier","pending"); jar.set("unrelated","keep");
      const req = request(jar);
      const {response} = await refreshSupabaseSession(req);
      assert.equal(response.status,200);
      assert.equal(req.cookies.get(key),undefined);
      assert.equal(req.cookies.get(key+"-code-verifier")?.value,"pending");
      assert.equal(req.cookies.get("unrelated")?.value,"keep");
      assert.ok(response.cookies.getAll().every(c=>c.name===key && c.maxAge===0));
    }
    for(const id of ["unknown-expired","unknown-fresh","down-expired","rate-expired","rotate-down-expired","invalidpayload-expired"]) {
      const jar = await seedSession(auth.origin,id);
      const req = request(jar);
      const result = await refreshSupabaseSession(req);
      assert.equal(result.response.status,503,id);
      assert.ok(result.response.cookies.getAll().every(c=>c.maxAge!==0));
      if(id.startsWith("unknown")) {
        for(const [name,value] of jar) assert.equal(req.cookies.get(name)?.value,value);
        assert.equal(result.response.cookies.getAll().length,0);
      }
      if(id.startsWith("rotate-down")) assert.ok(result.response.cookies.getAll().length>0);
      assert.throws(()=>result.finalizeResponse(NextResponse.next()),/failed verification/);
      assert.equal(await result.response.text(),"Authentication service unavailable.");
    }
    const malformed = request(new Map([[key,"invalid-json-cookie"]]));
    assert.equal((await refreshSupabaseSession(malformed)).response.status,200);
    assert.equal(malformed.cookies.get(key),undefined);
  } finally {
    ["NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"].forEach((name,index)=>{
      if(previous[index]===undefined) delete process.env[name]; else process.env[name]=previous[index];
    });
    await auth.close();
  }
});

test("Auth transport accepts legacy numeric HTTP code with a recognized error_code", async () => {
  const server = createServer((request, response) => {
    response.writeHead(400, {"content-type":"application/json"});
    response.end(JSON.stringify({code:request.url === "/unknown" ? "unknown_failure" : 400,
      error_code:"refresh_token_not_found",msg:"private-upstream-canary"}));
  });
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try {
    for(const route of ["/legacy","/unknown"]){
      const transport=createProxyAuthTransport();
      try {
        const response=await transport.fetch(origin+route),body=await response.json();
        assert.equal(transport.isUnavailable(),route === "/unknown");
        assert.equal(body.error_code,route === "/unknown" ? "volo_auth_unavailable" : "refresh_token_not_found");
        assert.ok(!JSON.stringify(body).includes("private-upstream-canary"));
      } finally {transport.close();}
    }
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test("Auth transport preserves success/rejection and bounds every outage including bodies", async () => {
  let calls = 0;
  const server = createServer((request, response) => {
    calls++;
    const route = request.url!;
    if (route === "/socket") { request.socket.destroy(); return; }
    if (route === "/hang") return;
    response.setHeader("Content-Type", "application/json");
    if (route === "/body") { response.writeHead(200); response.write('{"id":'); return; }
    const status = route === "/429" ? 429 : route === "/500" ? 500 : route === "/401" ? 401 : 200;
    response.writeHead(status);
    response.end(route === "/malformed" ? "invalid-json-canary" : JSON.stringify(
      route === "/401" ? {error_code:"bad_jwt",message:"fictional rejection"} :
      route === "/invalid" ? {} : {id:"fictional-a"}));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try {
    assert.equal(AUTH_VERIFICATION_TIMEOUT_MS, 5000);
    for (const route of ["/user", "/401", "/429", "/500", "/socket", "/malformed", "/invalid", "/hang", "/body"]) {
      const transport = createProxyAuthTransport();
      try {
        const started = Date.now();
        const response = await transport.fetch(origin + route);
        const healthy = ["/user", "/401"].includes(route);
        assert.equal(response.status, healthy ? route === "/401" ? 401 : 200 : 400, route);
        assert.equal(transport.isUnavailable(), !healthy, route);
        if(route === "/401") {
          const rejection = await response.json();
          assert.equal(rejection.error_code,"bad_jwt");
          assert.equal(rejection.message,"Authentication rejected.");
        }
        if (!healthy) assert.equal((await response.json()).error_code, "volo_auth_unavailable");
        if (["/hang", "/body"].includes(route)) {
          assert.ok(Date.now() - started >= 4900);
          assert.ok(Date.now() - started < 6500);
        }
        transport.close();
        const before = calls;
        assert.equal((await transport.fetch(origin + "/user")).status, 400);
        assert.equal(calls, before);
      } finally { transport.close(); }
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
