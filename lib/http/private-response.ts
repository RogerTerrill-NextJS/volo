import "server-only";

/** Replace browser and CDN policy without changing cookies or response metadata. */
export function applyPrivateResponseHeaders(headers: Headers): void {
  headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
  headers.set("CDN-Cache-Control", "no-store");
  headers.set("Netlify-CDN-Cache-Control", "no-store");
  headers.set("Expires", "0");
  headers.set("Pragma", "no-cache");
}
