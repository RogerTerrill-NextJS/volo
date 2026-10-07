import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

let server;
let baseUrl;
let serverOutput = "";
let serverError;

before(async () => {
  if (process.env.SMOKE_BASE_URL) {
    const target = new URL(process.env.SMOKE_BASE_URL);
    assert.ok(["http:", "https:"].includes(target.protocol), "Smoke target must use HTTP or HTTPS");
    assert.equal(target.username + target.password, "", "Do not put credentials in the smoke URL");
    assert.equal(target.pathname, "/", "Smoke target must be an origin without a path");
    assert.equal(target.search + target.hash, "", "Smoke target must not contain query parameters or a fragment");
    baseUrl = target.origin;
    return;
  }
  const portReservation = createServer();
  portReservation.listen(0, "127.0.0.1");
  await once(portReservation, "listening");
  const { port } = portReservation.address();
  await new Promise((resolve, reject) => {
    portReservation.close((error) => (error ? reject(error) : resolve()));
  });
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } },
  );
  server.on("error", (error) => { serverError = error; });
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (data) => {
      serverOutput = (serverOutput + data.toString()).slice(-8000);
    });
  }

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (serverError) throw serverError;
    if (server.exitCode !== null) {
      throw new Error(`Production server exited before becoming ready:\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(2000) });
      await response.text();
      return;
    } catch {
      await delay(200);
    }
  }
  throw new Error(`Production server did not become ready:\n${serverOutput}`);
}, { timeout: 35_000 });

after(() => {
  server?.kill();
});

test("homepage provides navigation to the dashboard", async () => {
  const response = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /href="\/dashboard"/);
});

test("public login provides the agreed destination and navigation home", async () => {
  const response = await fetch(`${baseUrl}/login`, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  const html = await response.text();
  assert.match(html, /<h1[^>]*>Sign in<\/h1>/);
  assert.match(html, /Sign-in is not available yet/);
  assert.match(html, /href="\/"/);
});

test("anonymous dashboard requests redirect to login without workspace content", async () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(`${baseUrl}/dashboard?verification=volo-109`, {
      headers: { Accept: "text/html" },
      redirect: "manual", signal: AbortSignal.timeout(5000),
    });
    const html = await response.text();
    assert.doesNotMatch(html, /Workspace overview/);
    assert.match(response.headers.get("cache-control") ?? "", /private/);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    if (response.status === 307) {
      assert.equal(new URL(response.headers.get("location"), baseUrl).href, `${baseUrl}/login`);
    } else {
      assert.equal(response.status, 200);
      assert.match(html, /url=\/login/);
    }
  }
});

test("anonymous dashboard RSC cannot expose workspace content", async () => {
  let route = "/dashboard";
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(baseUrl + route, {redirect: "manual", headers: {RSC: "1"}, signal: AbortSignal.timeout(5000)});
    const body = await response.text();
    assert.doesNotMatch(body, /Workspace overview/);
    if (response.status === 307) {
      const target = new URL(response.headers.get("location"), baseUrl);
      assert.equal(target.origin, baseUrl);
      if (target.pathname === "/dashboard" && target.searchParams.has("_rsc")) {
        route = target.pathname + target.search; continue;
      }
      assert.equal(target.href, `${baseUrl}/login`);
    } else {
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /text\/x-component/);
      assert.match(body, /NEXT_REDIRECT;replace;\/login;/);
    }
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    return;
  }
  assert.fail("RSC negotiation did not settle");
});

test("health endpoint returns a successful JSON response", async () => {
  const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("health Route Handler supports HEAD and advertises supported methods", async () => {
  const head = await fetch(`${baseUrl}/api/health`, {
    method: "HEAD",
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(head.status, 200);
  assert.match(head.headers.get("content-type"), /application\/json/);
  assert.equal(await head.text(), "");

  const options = await fetch(`${baseUrl}/api/health`, {
    method: "OPTIONS",
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(options.status, 204);
  const allowed = options.headers.get("allow")?.split(",").map((method) => method.trim());
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.ok(allowed?.includes(method), `Allow header must include ${method}`);
  }
});

test("health Route Handler rejects unsupported POST requests", async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    method: "POST",
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 405);
});

test("unknown nested page and API paths return 404 instead of the homepage", async () => {
  for (const path of ["/dashboard/volo-109-missing", "/api/volo-109-missing"]) {
    const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(await response.text(), /href="\/dashboard"/);
  }
});
