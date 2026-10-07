import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { AUTH_VERIFICATION_TIMEOUT_MS, createProxyAuthTransport } from "../lib/supabase/proxy-auth.ts";

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
