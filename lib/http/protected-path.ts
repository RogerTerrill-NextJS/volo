import "server-only";

/** Cache policy only; each protected boundary independently authorizes requests. */
export function isProtectedPagePath(pathname: string): boolean {
  return pathname === "/" || pathname === "/login" || pathname === "/login/"
    || pathname === "/account/setup" || pathname === "/account/setup/"
    || pathname === "/dashboard" || pathname.startsWith("/dashboard/")
    || pathname === "/reports" || pathname.startsWith("/reports/")
    || pathname === "/messages" || pathname.startsWith("/messages/")
    || pathname === "/directory" || pathname.startsWith("/directory/")
    || pathname === "/admin" || pathname.startsWith("/admin/");
}
