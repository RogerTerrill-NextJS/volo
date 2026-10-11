import 'server-only';
import {cookies} from 'next/headers';
import {confirmationCookieNames} from './invitation-setup.ts';
import {confirmationDigest,isConfirmationSecret} from './invitation-confirmation-crypto.ts';
import {createConfirmationStore} from './invitation-confirmation-store.ts';
import {createConfirmationAuthTransport,verifyConfirmationSession} from './invitation-confirmation-auth.ts';
import {createServerSupabaseClient} from '../supabase/server.ts';
import {parseMutationOrigin} from './mutation-origin.mjs';

export function resetCsrf(cookie:string){return confirmationDigest('volo-password-reset-csrf-v1:'+cookie);}
export async function getPasswordRecovery():Promise<{status:'authorized';csrf:string}|{status:'denied'|'unavailable'}>{
 const transport=createConfirmationAuthTransport();
 try{
  const origin=parseMutationOrigin(process.env.VOLO_MUTATION_ORIGIN??'',true),cookie=(await cookies()).get(confirmationCookieNames(origin).recovery)?.value;
  if(!isConfirmationSecret(cookie))return {status:'denied'};
  const client=await createServerSupabaseClient({cookieMode:'read-only',fetch:transport.fetch}),verified=await verifyConfirmationSession(client);
  if(transport.isUnavailable()||verified.code==='unavailable')return {status:'unavailable'};
  if(verified.code!=='verified')return {status:'denied'};
  const grant=await createConfirmationStore().recovery('read',{digest:confirmationDigest(cookie),identity:verified.identity,origin});
  return grant.code==='authorized'?{status:'authorized',csrf:resetCsrf(cookie)}:{status:grant.code==='unavailable'?'unavailable':'denied'};
 }catch{return {status:'unavailable'};}finally{transport.close();}
}
