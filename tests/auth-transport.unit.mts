import assert from "node:assert/strict";
import {createServer} from "node:http";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";
import {test} from "node:test";
import {createMembershipTransport, MEMBERSHIP_TIMEOUT_MS} from "../lib/auth/membership-transport.ts";

test("membership transport bounds bodies, sanitizes failures and cancels later work", async () => {
  let calls = 0;
  const rows = [{user_id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",role:"member",status:"active"}];
  const server = createServer((req,res) => {
    calls++;
    res.setHeader("content-type","application/json");
    if(req.url==="/socket") {req.socket.destroy();return;}
    if(req.url==="/hang") return;
    if(req.url==="/body") {res.writeHead(200);res.write("[");return;}
    if(req.url==="/slow") {setTimeout(()=>res.end(JSON.stringify(rows)),100);return;}
    if(req.url==="/null-row") {res.end("[null]");return;}
    const status = Number(req.url?.slice(1));
    if(status>=400) {res.writeHead(status).end(JSON.stringify({message:"private-membership-canary"}));return;}
    res.end(req.url==="/invalid" ? "private-membership-canary" : JSON.stringify(req.url==="/empty"?[]:rows));
  });
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const address=server.address();assert.ok(address && typeof address!=="string");
  const origin=`http://127.0.0.1:${address.port}`;
  assert.equal(MEMBERSHIP_TIMEOUT_MS,5000);
  try {
    const lazy=createMembershipTransport();
    await delay(5100); // Auth phase does not consume membership's budget.
    const independent=createMembershipTransport();
    const [first,second]=await Promise.all([lazy.fetch(origin+"/slow"),independent.fetch(origin+"/empty")]);
    assert.deepEqual(await first.json(),rows);assert.deepEqual(await second.json(),[]);
    assert.equal(lazy.isUnavailable(),false);assert.equal(independent.isUnavailable(),false);
    lazy.close();independent.close();
    for(const route of ["/null-row","/401","/403","/429","/500","/socket","/invalid","/hang","/body"]) {
      const transport=createMembershipTransport();const started=Date.now();
      try {
        const response=await transport.fetch(origin+route);
        assert.equal(response.status,400,route);
        assert.deepEqual(await response.json(),{message:"Membership service unavailable."});
        assert.equal(transport.isUnavailable(),true);assert.ok(Date.now()-started<6500,route);
        const before=calls;await transport.fetch(origin+"/empty");assert.equal(calls,before);
      } finally {transport.close();}
    }
    const closed=createMembershipTransport();closed.close();const before=calls;
    assert.equal((await closed.fetch(origin+"/empty")).status,400);assert.equal(calls,before);
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
