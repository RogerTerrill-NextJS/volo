import "server-only";
import {createClient} from "@supabase/supabase-js";
import type {Database} from "../supabase/database.types";
import {getSupabasePrivilegedConfig} from "../supabase/privileged-config.mjs";

export type InvitationEligibilityInput = Readonly<{
  invitationId:string; expectedVersion:number; verifiedSubject:string; verifiedEmail:string;
}>;
export type InvitationEligibility = "eligible" | "not_eligible" | "unavailable";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const states=["pending_issuance","issued","setup_verified","password_established","revoked","superseded","redeemed"];
function emailKey(value:unknown):string|null {
  if(typeof value!=="string") return null;
  const email=value.trim();
  if(email.length>254 || !/^[\x21-\x7e]+@[\x21-\x7e]+$/.test(email) || email.split("@").length!==2) return null;
  return email.replace(/[A-Z]/g,char=>char.toLowerCase());
}

/** Internal current-state check. Identity/email must come from server-verified Auth,
 * never form fields or editable metadata. This is neither a setup grant nor a lock:
 * consumers validate their provider/session authority and recheck under transaction
 * locks before mutation. Never cache this result or use it to grant membership.
 */
export async function readInvitationEligibility(input:InvitationEligibilityInput):Promise<InvitationEligibility> {
  const email=emailKey(input?.verifiedEmail);
  if(!input || typeof input.invitationId!=="string" || !uuid.test(input.invitationId) ||
    typeof input.verifiedSubject!=="string" || !uuid.test(input.verifiedSubject) ||
    !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion<1 || !email) return "not_eligible";
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    const {url,secretKey}=getSupabasePrivilegedConfig();
    const client=createClient<Database>(url,secretKey,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      global:{fetch:async(resource,init)=>{
        timer=setTimeout(()=>controller.abort(),5000);
        const response=await fetch(resource,{...init,signal:controller.signal,cache:"no-store",redirect:"error"});
        // Buffer within the deadline so a stalled response body cannot hang the read.
        const body=await response.text();
        if(controller.signal.aborted) throw new Error("Invitation service unavailable.");
        return new Response(body,{status:response.status,headers:response.headers});
      }},
    });
    const result=await client.from("invitations")
      .select("id,version,status,recipient_email_key,auth_user_id,verified_user_id")
      .eq("id",input.invitationId).retry(false);
    if(result.error || controller.signal.aborted || !Array.isArray(result.data) || result.data.length>1) return "unavailable";
    if(result.data.length===0) return "not_eligible";
    const row=result.data[0];
    if(!row || row.id!==input.invitationId || !Number.isSafeInteger(row.version) || row.version<1 ||
      !states.includes(row.status) || typeof row.recipient_email_key!=="string" || emailKey(row.recipient_email_key)!==row.recipient_email_key ||
      (row.auth_user_id!==null && (typeof row.auth_user_id!=="string" || !uuid.test(row.auth_user_id))) ||
      (row.verified_user_id!==null && (typeof row.verified_user_id!=="string" || !uuid.test(row.verified_user_id)))) return "unavailable";
    if(!["issued","setup_verified","password_established"].includes(row.status) ||
      row.version!==input.expectedVersion || row.auth_user_id!==input.verifiedSubject || row.recipient_email_key!==email ||
      (row.status!=="issued" && row.verified_user_id!==input.verifiedSubject)) return "not_eligible";
    return "eligible";
  } catch {return "unavailable";}
  finally {clearTimeout(timer);controller.abort();}
}
