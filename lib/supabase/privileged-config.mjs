import "server-only";
import { getSupabasePublicConfig } from "./public-config.mjs";

/** Only for explicitly authorized server jobs; never serialize this result.
 * Reading is lazy: ordinary app builds do not require a privileged key.
 */
export function getSupabasePrivilegedConfig() {
  const { url } = getSupabasePublicConfig();
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(secretKey)) {
    throw new Error("SUPABASE_SECRET_KEY must be configured with a secret key for this privileged server operation. See docs/environment-configuration.md.");
  }
  return { url, secretKey };
}
