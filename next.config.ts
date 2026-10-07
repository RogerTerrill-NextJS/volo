import type { NextConfig } from "next";
import { validateEnvironment } from "./lib/environment.mjs";

// Next.js has loaded .env files before evaluating this configuration.
validateEnvironment(process.env);

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
