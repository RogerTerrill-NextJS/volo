import type { NextRequest } from "next/server.js";
import { refreshSupabaseSession } from "./lib/supabase/proxy.ts";

export async function proxy(request: NextRequest) {
  return (await refreshSupabaseSession(request)).response;
}

export const config = {
  matcher: ["/((?!auth/confirm/?$|account/complete/?$|_next/static(?:/|$)|_next/image(?:/|$)|api/health/?$|(?:favicon\\.ico|robots\\.txt|sitemap\\.xml|file\\.svg|globe\\.svg|next\\.svg|vercel\\.svg|window\\.svg)$).*)"],
};
