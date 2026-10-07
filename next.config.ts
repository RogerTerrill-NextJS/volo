import type { NextConfig } from "next";
import { validateEnvironment } from "./lib/environment.mjs";
import { resolveMutationOrigin } from "./lib/auth/mutation-origin.mjs";

// Next.js has loaded .env files before evaluating this configuration.
validateEnvironment(process.env);

const nextConfig: NextConfig = {
  env: { VOLO_MUTATION_ORIGIN: resolveMutationOrigin(process.env) },
  experimental: { serverActions: { bodySizeLimit: "64kb" } },
};

export default nextConfig;
