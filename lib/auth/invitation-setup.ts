import 'server-only';
import {cookies} from 'next/headers';
import {createServerSupabaseClient} from '../supabase/server.ts';
import {createConfirmationStore} from './invitation-confirmation-store.ts';
import {confirmationDigest,isConfirmationSecret} from './invitation-confirmation-crypto.ts';
import {createConfirmationAuthTransport,verifyConfirmationSession} from './invitation-confirmation-auth.ts';
import {parseMutationOrigin} from './mutation-origin.mjs';
export function confirmationCookieNames(origin:string){
 const url=new URL(parseMutationOrigin(origin,true)),secure=url.protocol==='https:';
 return {confirmation:secure?'__Host-volo-confirmation':'volo-confirmation',setup:secure?'__Host-volo-setup':'volo-setup',secure};
}
export async function getVerifiedInvitationSetup():Promise<{status:'authorized';invitationId:string;version:number;authorizationId:string;expiresAt:string}|{status:'denied'|'unavailable'}>{
 const transport=createConfirmationAuthTransport();
 try{
  const origin=parseMutationOrigin(process.env.VOLO_MUTATION_ORIGIN??'',true),name=confirmationCookieNames(origin).setup;
  const cookie=(await cookies()).get(name)?.value;if(!isConfirmationSecret(cookie))return {status:'denied'};
  const client=await createServerSupabaseClient({cookieMode:'read-only',fetch:transport.fetch});
  const verified=await verifyConfirmationSession(client);if(transport.isUnavailable())return {status:'unavailable'};
  if(verified.code!=='verified')return {status:verified.code};
  const result=await createConfirmationStore().readSetup({setupDigest:confirmationDigest(cookie),identity:verified.identity,origin});
  if(result.code!=='authorized')return {status:result.code};
  return {status:'authorized',invitationId:result.invitationId,version:result.version,authorizationId:result.authorizationId,expiresAt:result.expiresAt};
 }catch{return {status:'unavailable'};}finally{transport.close();}
}
