import "server-only";
import {isAuthSessionMissingError} from "@supabase/supabase-js";
import type {Database} from "../supabase/database.types";
import {getSupabasePublicConfig} from "../supabase/public-config.mjs";
import {createServerSupabaseClient} from "../supabase/server";
import {AUTH_CREDENTIAL_CODES,createProxyAuthTransport} from "../supabase/proxy-auth.ts";
import {createMembershipTransport} from "./membership-transport.ts";

export type MemberRole = Database["public"]["Enums"]["member_role"];
export type ActiveMember = Readonly<{userId:string;role:MemberRole}>;
export type AccessFailure = "unauthenticated" | "forbidden" | "unavailable";
export type AccessResult = {status:"authorized";member:ActiveMember} | {status:AccessFailure};
const messages = {unauthenticated:"Authentication required.",forbidden:"Access denied.",unavailable:"Access service unavailable."};
export class AccessError extends Error {
  readonly code: AccessFailure;
  constructor(code: AccessFailure) {super(messages[code]);this.name="AccessError";this.code=code;}
}
const isRole = (value: unknown): value is MemberRole => value==="member" || value==="admin";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A fresh decision at the data boundary; never a durable grant or shared cache. */
export async function getAccess(): Promise<AccessResult> {
  const {url} = getSupabasePublicConfig();
  const base = new URL(url);
  const auth = createProxyAuthTransport();
  const membership = createMembershipTransport();
  let refreshAttempted = false;
  try {
    const client = await createServerSupabaseClient({cookieMode:"read-only",fetch:async(input,init)=>{
      const target = new URL(input instanceof Request ? input.url : String(input));
      if(target.origin===base.origin && ["/auth/v1/user","/auth/v1/token"].includes(target.pathname)) {
        if(target.pathname==="/auth/v1/token") refreshAttempted=true;
        return auth.fetch(input,{...init,cache:"no-store"});
      }
      if(target.origin===base.origin && target.pathname==="/rest/v1/memberships") return membership.fetch(input,init);
      throw new Error("Unexpected access service request.");
    }});
    const {data,error} = await client.auth.getUser();
    auth.close(); // Membership has a separate, lazy deadline.
    if(auth.isUnavailable()) return {status:"unavailable"};
    if(error) return {status:isAuthSessionMissingError(error) || AUTH_CREDENTIAL_CODES.has(error.code??"") ? "unauthenticated" : "unavailable"};
    // Read-only checks cannot establish a browser session through an unpersisted refresh.
    if(refreshAttempted || !data.user || typeof data.user.id!=="string" || !uuid.test(data.user.id)) return {status:"unavailable"};
    const subject=data.user.id;
    const result=await client.from("memberships").select("user_id,role,status").eq("user_id",subject).retry(false).maybeSingle();
    if(auth.isUnavailable() || membership.isUnavailable() || result.error) return {status:"unavailable"};
    const row=result.data;
    if(row===null) return {status:"forbidden"};
    if(!row || row.user_id!==subject || !isRole(row.role) || !["active","disabled"].includes(row.status)) return {status:"unavailable"};
    if(row.status!=="active") return {status:"forbidden"};
    return {status:"authorized",member:{userId:subject,role:row.role}};
  } finally {auth.close();membership.close();}
}

export async function requireActiveMember(): Promise<ActiveMember> {
  const result=await getAccess();
  if(result.status!=="authorized") throw new AccessError(result.status);
  return result.member;
}

export async function requireRole(allowedRoles: readonly MemberRole[]): Promise<ActiveMember> {
  const member=await requireActiveMember();
  if(!Array.isArray(allowedRoles) || allowedRoles.length===0 || !allowedRoles.every(isRole) || !allowedRoles.includes(member.role)) {
    throw new AccessError("forbidden");
  }
  return member;
}
