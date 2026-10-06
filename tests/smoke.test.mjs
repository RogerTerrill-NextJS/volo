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

test("dashboard supports a direct request and navigation home", async () => {
  const response = await fetch(`${baseUrl}/dashboard`, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<h1[^>]*>Volo dashboard<\/h1>/);
  assert.match(html, /href="\/"/);
});

test("health endpoint returns a successful JSON response", async () => {
  const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.deepEqual(await response.json(), { status: "ok" });
});
