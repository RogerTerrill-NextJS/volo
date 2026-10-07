import { createServer } from "node:http";
import { once } from "node:events";
import { createServerClient } from "@supabase/ssr";

export const fixtureKey = "sb_publishable_proxy_fixture";
export async function startAuthFixture() {
  const calls = [];
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const user = (id, large = false) => ({ id, aud:"authenticated", role:"authenticated",
    email:`${id}@example.invalid`, app_metadata:{}, user_metadata:{padding:large ? "x".repeat(6000) : ""},
    created_at:"2026-01-01T00:00:00Z" });
  const session = (id, expired, large, rotated = false) => ({
    access_token: `${encode({alg:"HS256",typ:"JWT"})}.${encode({sub:id,exp:expired ? 1000000000 : 4102444800})}.fictional-signature`,
    refresh_token: `fixture-refresh-${id}${rotated ? "-rotated" : ""}`,
    token_type:"bearer", expires_in:expired ? -60 : 3600,
    expires_at:expired ? 1000000000 : 4102444800, user:user(id,large),
  });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://fixture.invalid");
    let body = "";
    for await (const chunk of request) body += chunk;
    const data = body ? JSON.parse(body) : {};
    const password = url.searchParams.get("grant_type") === "password";
    const refresh = url.searchParams.get("grant_type") === "refresh_token";
    const id = password ? data.email.split("@")[0] : refresh ?
      data.refresh_token.replace(/^fixture-refresh-/, "").replace(/-rotated$/, "") :
      request.headers.authorization ? JSON.parse(Buffer.from(request.headers.authorization.split(" ")[1].split(".")[1], "base64url").toString()).sub : "anonymous";
    calls.push({path:url.pathname, grant:url.searchParams.get("grant_type"), id});
    response.setHeader("Content-Type", "application/json");
    response.setHeader("X-Supabase-Api-Version", "2024-01-01");
    if (password && url.pathname === "/auth/v1/token") {
      response.end(JSON.stringify(session(id, id.includes("expired"), id.includes("large")))); return;
    }
    if (refresh || url.pathname === "/auth/v1/user") {
      if (id.startsWith("socket")) { request.socket.destroy(); return; }
      if (id.startsWith("hang")) return;
      if (id.startsWith("body")) { response.writeHead(200); response.write('{"user":'); return; }
      if (id.startsWith("down") || (id.startsWith("rotate-down") && !refresh)) {
        response.writeHead(503).end(JSON.stringify({message:"private-upstream-error-canary"})); return;
      }
      if (id.startsWith("rate")) { response.writeHead(429).end(JSON.stringify({message:"private-upstream-error-canary"})); return; }
      if (id.startsWith("malformed")) { response.end("private-upstream-error-canary"); return; }
      if (id.startsWith("invalidpayload")) { response.end("{}"); return; }
      if (id.startsWith("rejected") || id.startsWith("revoked")) {
        response.writeHead(refresh ? 400 : 401).end(JSON.stringify({code:refresh ? "refresh_token_not_found" : "bad_jwt",message:"private-upstream-error-canary"})); return;
      }
      response.end(JSON.stringify(refresh ? session(id,false,false,true) : user(id))); return;
    }
    response.writeHead(418).end(JSON.stringify({message:"unexpected fixture route"}));
  });
  server.listen(0,"127.0.0.1");
  await once(server,"listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {origin, calls, async close() {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }};
}

export async function seedSession(origin, id) {
  const jar = new Map();
  const client = createServerClient(origin,fixtureKey,{cookies:{
    getAll:()=>[...jar].map(([name,value])=>({name,value})),
    setAll:updates=>{for(const {name,value,options} of updates) {
      if(options.maxAge === 0) jar.delete(name); else jar.set(name,value);
    }},
  }});
  const {error} = await client.auth.signInWithPassword({email:`${id}@example.invalid`,password:"fictional-password"});
  if(error) throw new Error("Fictional session seeding failed");
  return jar;
}
export const cookieHeader = jar => [...jar].map(([name,value])=>`${name}=${value}`).join("; ");
