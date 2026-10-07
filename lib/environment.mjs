/** Validate startup configuration without returning or logging supplied values.
 * @param {Record<string, string | undefined>} env
 */
export function validateEnvironment(env) {
  const problems = [];
  const publicNames = new Set(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
  for (const name of Object.keys(env)) {
    if (name.startsWith("NEXT_PUBLIC_SUPABASE_") && !publicNames.has(name)) {
      problems.push(`${name} is not an allowed browser-public Supabase variable. Use server-only configuration for privileged credentials.`);
    }
  }
  try {
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      !(url.protocol === "https:" || (url.protocol === "http:" && local)) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash
    ) {
      throw new Error();
    }
  } catch {
    problems.push("NEXT_PUBLIC_SUPABASE_URL must be an HTTPS origin (HTTP is allowed only for local loopback).");
  }

  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "")) {
    problems.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a publishable key beginning sb_publishable_.");
  }

  if (problems.length) {
    throw new Error(
      `Invalid environment configuration:\n${problems.join("\n")}\n` +
      "Copy .env.example to .env.local for local development, or configure the Netlify build context. See docs/environment-configuration.md.",
    );
  }
}
