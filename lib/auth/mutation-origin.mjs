/** Return a canonical origin only; reject URL normalization hiding extra syntax.
 * @param {string} value
 * @param {boolean} local
 */
export function parseMutationOrigin(value, local = false) {
  const url = new URL(value);
  if ((value !== url.origin && value !== url.origin + "/") || url.username || url.password ||
      url.hostname.includes("*") || !(url.protocol === "https:" ||
      (local && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("Invalid mutation origin configuration.");
  }
  return url.origin;
}

/** Capture trusted deployment metadata at build time, never request headers.
 * @param {Record<string,string|undefined>} env
 */
export function resolveMutationOrigin(env) {
  try {
    const hosted = env.NETLIFY === "true" || Boolean(env.CONTEXT);
    if (hosted) {
      if (env.CONTEXT === "deploy-preview") return parseMutationOrigin(env.DEPLOY_PRIME_URL ?? "");
      if (env.CONTEXT === "production") return parseMutationOrigin(env.URL ?? "");
      throw new Error();
    }
    return env.VOLO_MUTATION_ORIGIN ? parseMutationOrigin(env.VOLO_MUTATION_ORIGIN, true) : "";
  } catch { throw new Error("Invalid mutation origin configuration."); }
}
