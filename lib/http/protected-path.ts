import "server-only";

/** Cache policy only; each protected boundary independently authorizes requests. */
export function isProtectedPagePath(pathname: string): boolean {
  return pathname === "/account/setup" || pathname === "/account/setup/"
    || pathname === "/dashboard" || pathname.startsWith("/dashboard/")
    || pathname === "/admin" || pathname.startsWith("/admin/");
}
