import type { NextConfig } from "next";
import { validateEnvironment } from "./lib/environment.mjs";
import { resolveMutationOrigin } from "./lib/auth/mutation-origin.mjs";

// Next.js has loaded .env files before evaluating this configuration.
validateEnvironment(process.env);

const nextConfig: NextConfig = {
  env: { VOLO_MUTATION_ORIGIN: resolveMutationOrigin(process.env) },
  async headers() {
    return [{source: '/sw.js', headers: [
      {key: 'Content-Type', value: 'application/javascript; charset=utf-8'},
      {key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate'},
      {key: 'CDN-Cache-Control', value: 'no-store'},
      {key: 'Netlify-CDN-Cache-Control', value: 'no-store'},
      {key: 'Content-Security-Policy', value: "default-src 'none'; script-src 'self'; connect-src 'self'"},
      {key: 'X-Content-Type-Options', value: 'nosniff'},
    ]}];
  },
  experimental: { serverActions: { bodySizeLimit: "64kb" } },
};

export default nextConfig;
