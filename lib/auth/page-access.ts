import "server-only";
import { redirect } from "next/navigation";
import { getAccess, type ActiveMember } from "./access";

export type PageAccessResult =
  | { status: "authorized"; member: ActiveMember }
  | { status: "forbidden" | "unavailable" };

/** Invoke independently at each protected page/data boundary, never just a layout. */
export async function getPageAccess(): Promise<PageAccessResult> {
  const access = await getAccess();
  // Netlify inherits incoming query parameters when the destination has none.
  // A fixed query prevents return URLs or token-looking input from being copied.
  if (access.status === "unauthenticated") redirect("/login?reason=authentication-required");
  if (access.status === "authorized") return access;
  return { status: access.status };
}
