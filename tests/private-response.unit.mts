import assert from "node:assert/strict";
import test from "node:test";
import {applyPrivateResponseHeaders} from "../lib/http/private-response.ts";
import {isProtectedPagePath} from "../lib/http/protected-path.ts";

test("private policy replaces conflicting cache fields and preserves response metadata", () => {
  const headers = new Headers({
    "Cache-Control":"public, s-maxage=600, stale-while-revalidate=60",
    "CDN-Cache-Control":"public, max-age=600",
    "Netlify-CDN-Cache-Control":"public, s-maxage=600, durable",
    Vary:"RSC, Next-Router-State-Tree", Location:"/login", "X-Fixture":"preserve",
  });
  headers.append("Set-Cookie","first=a; Path=/");
  headers.append("Set-Cookie","second=b; Path=/");
  const cookies = headers.getSetCookie();
  applyPrivateResponseHeaders(headers);
  assert.equal(headers.get("Cache-Control"),"private, no-cache, no-store, must-revalidate, max-age=0");
  for (const key of ["CDN-Cache-Control","Netlify-CDN-Cache-Control"]) assert.equal(headers.get(key),"no-store");
  assert.deepEqual(headers.getSetCookie(),cookies);
  assert.equal(headers.get("Vary"),"RSC, Next-Router-State-Tree");
  assert.equal(headers.get("Location"),"/login");
  assert.equal(headers.get("X-Fixture"),"preserve");
  assert.equal(headers.get("Expires"),"0");
  assert.equal(headers.get("Pragma"),"no-cache");
  const once = [...headers];
  applyPrivateResponseHeaders(headers);
  assert.deepEqual([...headers],once);
});

test("protected roots match complete segments", () => {
  for (const path of ["/dashboard","/dashboard/","/dashboard/report.csv"]) assert.equal(isProtectedPagePath(path),true,path);
  for (const path of ["/","/login","/dashboard-public","/dashboards","/api/health","/_next/static/app.js"]) assert.equal(isProtectedPagePath(path),false,path);
});
