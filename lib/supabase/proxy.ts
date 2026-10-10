import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server.js";
import type { Database } from "./database.types";
import { getSupabasePublicConfig } from "./public-config.mjs";
import { AUTH_CREDENTIAL_CODES, createProxyAuthTransport } from "./proxy-auth.ts";
import { applyPrivateResponseHeaders } from "../http/private-response.ts";
import { isProtectedPagePath } from "../http/protected-path.ts";

/** Refresh only. Consumers still verify identity and membership at their boundary. */
export async function refreshSupabaseSession(request: NextRequest) {
  const { url, publishableKey } = getSupabasePublicConfig();
  const name = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const isSession = (key: string) => key === name ||
    (key.startsWith(name + ".") && /^\d+$/.test(key.slice(name.length + 1)));
  const original = request.cookies.getAll().filter(cookie => isSession(cookie.name));
  const updates = new Map<string, {name: string; value: string; options: CookieOptions}>();
  const metadata = new Headers();
  let failed = false;
  const apply = (update: {name: string; value: string; options: CookieOptions}) => {
    updates.set(update.name, update);
    if (update.options.maxAge === 0 || (update.options.expires && update.options.expires.getTime() <= Date.now())) {
      request.cookies.delete(update.name);
    } else request.cookies.set(update.name, update.value);
  };
  if (original.length > 0) {
    const transport = createProxyAuthTransport();
    try {
      const client = createServerClient<Database>(url, publishableKey, {
        cookieOptions: {name}, global: {fetch: transport.fetch},
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: (cookies, headers) => {
            // A local terminal transport error can trigger SDK sign-out cleanup.
            // Keep completed rotations, but do not commit outage-induced deletions.
            if (transport.isUnavailable()) return;
            for (const update of cookies) if (isSession(update.name)) apply(update);
            for (const [key, value] of Object.entries(headers)) metadata.set(key, value);
          },
        },
      });
      const { data, error } = await client.auth.getUser();
      const rejected = error && (isAuthSessionMissingError(error) || AUTH_CREDENTIAL_CODES.has(error.code ?? ""));
      if (transport.isUnavailable() || (error && !rejected) || (!error && !data.user?.id)) failed = true;
      else if (rejected) {
        for (const key of new Set([...original.map(cookie => cookie.name), ...updates.keys()])) {
          apply({name:key, value:"", options:{path:"/", sameSite:"lax", maxAge:0, expires:new Date(0)}});
        }
      }
    } finally { transport.close(); }
  }
  const finalizeResponse = (response: NextResponse) => {
    if (failed && response.status < 500) throw new Error("Cannot replace failed verification with a successful response.");
    for (const {name, value, options} of updates.values()) response.cookies.set(name, value, options);
    // Incoming request cookies are forwarded explicitly, never through a browser-visible header.
    response.headers.delete("x-middleware-set-cookie");
    if (request.nextUrl.pathname === "/account/setup" || request.nextUrl.pathname === "/account/setup/") response.headers.set("Referrer-Policy", "no-referrer");
    for (const [key, value] of metadata) response.headers.set(key, value);
    if (original.length > 0 || updates.size > 0 || failed || isProtectedPagePath(request.nextUrl.pathname)) {
      applyPrivateResponseHeaders(response.headers);
    }
    return response;
  };
  const response = failed ? new NextResponse("Authentication service unavailable.", {status:503}) :
    NextResponse.next({request:{headers:new Headers(request.headers)}});
  return {response:finalizeResponse(response), finalizeResponse};
}
