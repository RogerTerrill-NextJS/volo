import "server-only";
import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";
import { getSupabasePublicConfig } from "./public-config.mjs";
import { applyPrivateResponseHeaders } from "../http/private-response.ts";

type ServerClientOptions = {fetch?: typeof globalThis.fetch} & (
  | { cookieMode: "read-only" }
  | {
      cookieMode: "read-write";
      /** Apply SDK cache protections to the response that carries these cookies. */
      setResponseHeaders: (headers: Record<string, string>) => void | Promise<void>;
    });

/** Fresh per request. Writable callers own both the cookies and response headers. */
export async function createServerSupabaseClient(options: ServerClientOptions) {
  if (!options || !["read-only", "read-write"].includes(options.cookieMode)) {
    throw new Error("Supabase server client requires an explicit valid cookieMode.");
  }
  if (options.cookieMode === "read-write" && typeof options.setResponseHeaders !== "function") {
    throw new Error("Supabase read-write client requires setResponseHeaders.");
  }
  const { url, publishableKey } = getSupabasePublicConfig();
  const store = await cookies();
  const adapter: CookieMethodsServer = { getAll: () => store.getAll() };
  if (options.cookieMode === "read-write") {
    adapter.setAll = async (updates, headers) => {
      const responseHeaders = new Headers(headers);
      applyPrivateResponseHeaders(responseHeaders);
      await options.setResponseHeaders(Object.fromEntries(responseHeaders));
      for (const { name, value, options: cookieOptions } of updates) {
        store.set(name, value, cookieOptions);
      }
    };
  }
  return createServerClient<Database>(url, publishableKey, {
    cookies: adapter,
    ...(options.fetch ? {global:{fetch:options.fetch}} : {}),
  });
}
