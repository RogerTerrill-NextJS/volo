import "server-only";

/** Cache policy only; each protected boundary independently authorizes requests. */
export function isProtectedPagePath(pathname: string): boolean {
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/")
    || pathname === "/admin" || pathname.startsWith("/admin/");
}
