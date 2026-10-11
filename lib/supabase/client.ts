import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { getSupabasePublicConfig } from "./public-config.mjs";

/** Browser-safe; also constructible while rendering a Client Component on the server. */
export function createBrowserSupabaseClient(options?:{fetch:typeof fetch}) {
  const { url, publishableKey } = getSupabasePublicConfig();
  return createBrowserClient<Database>(url, publishableKey,options?{isSingleton:false,global:{fetch:options.fetch}}:undefined);
}
