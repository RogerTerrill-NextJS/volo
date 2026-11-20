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

/** Vercel system URLs contain only a public hostname, never request-derived data.
 * @param {string|undefined} hostname
 */
function vercelOrigin(hostname) {
  if (!hostname || hostname.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) throw new Error("Invalid mutation origin configuration.");
  return parseMutationOrigin(`https://${hostname}`);
}

/** Optional Git branch alias: navigation only, never an additional trusted origin.
 * @param {Record<string,string|undefined>} env
 */
export function resolvePreviewAliasOrigin(env) {
  if (env.VERCEL_ENV !== "preview" || !env.VERCEL_BRANCH_URL) return "";
  return vercelOrigin(env.VERCEL_BRANCH_URL);
}

/** Capture trusted deployment metadata at build time, never request headers.
 * @param {Record<string,string|undefined>} env
 */
export function resolveMutationOrigin(env) {
  try {
    const netlify = env.NETLIFY === "true" || Boolean(env.CONTEXT);
    const vercel = env.VERCEL === "1" || Boolean(env.VERCEL_ENV);
    if (netlify && vercel) throw new Error();
    if (vercel) {
      if (env.VERCEL_ENV === "preview") {
        return vercelOrigin(env.VERCEL_URL);
      }
      if (env.VERCEL_ENV === "production") return parseMutationOrigin(env.VOLO_MUTATION_ORIGIN ?? "");
      throw new Error();
    }
    if (netlify) {
      if (env.CONTEXT === "deploy-preview") return parseMutationOrigin(env.DEPLOY_PRIME_URL ?? "");
      if (env.CONTEXT === "production") return parseMutationOrigin(env.URL ?? "");
      throw new Error();
    }
    return env.VOLO_MUTATION_ORIGIN ? parseMutationOrigin(env.VOLO_MUTATION_ORIGIN, true) : "";
  } catch { throw new Error("Invalid mutation origin configuration."); }
}
