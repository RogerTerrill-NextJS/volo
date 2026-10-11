import {NextResponse,type NextRequest} from 'next/server';
import {createClient} from '@supabase/supabase-js';
import {getSupabasePublicConfig} from '../../../lib/supabase/public-config.mjs';
import {createProxyAuthTransport} from '../../../lib/supabase/proxy-auth.ts';
import {checkMutationOrigin} from '../../../lib/auth/mutation-request.ts';
import {parseMutationOrigin} from '../../../lib/auth/mutation-origin.mjs';
import {readPasswordRecoveryInput} from '../../../lib/auth/password-recovery-input.ts';
import {applyPrivateResponseHeaders} from '../../../lib/http/private-response.ts';

export const runtime='nodejs';
function privateHeaders(){const headers=new Headers();applyPrivateResponseHeaders(headers);headers.set('Referrer-Policy','no-referrer');return headers;}
export async function POST(request:NextRequest){
 const headers=privateHeaders();let origin:string;
 try{origin=parseMutationOrigin(process.env.VOLO_MUTATION_ORIGIN??'',true);}
 catch{return new NextResponse(null,{status:503,headers});}
 if(checkMutationOrigin(request.headers,origin)!==null)return new NextResponse(null,{status:403,headers});
 if(request.nextUrl.search)return new NextResponse(null,{status:400,headers});
 const redirect=(result:'sent'|'invalid_input')=>new NextResponse(null,{status:303,headers:new Headers([...headers,['Location',new URL('/forgot-password?result='+result,origin).href]])});
 const email=await readPasswordRecoveryInput(request);if(!email)return redirect('invalid_input');
 let transport:ReturnType<typeof createProxyAuthTransport>|undefined;
 try{
  const {url,publishableKey}=getSupabasePublicConfig();transport=createProxyAuthTransport();
  // Recovery mail initiation has no browser-session authority. Token-hash links
  // use server confirmation, so no PKCE verifier or session cookie is established.
  const client=createClient(url,publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,flowType:'implicit'},global:{fetch:transport.fetch}});
  const callback=new URL('/auth/confirm',origin);callback.searchParams.set('flow','recovery');
  await client.auth.resetPasswordForEmail(email,{redirectTo:callback.href});
 }catch{/* Provider/configuration details and account existence are never disclosed. */}
 finally{transport?.close();}
 // Provider rejection, rate limit and outage deliberately share this outcome.
 return redirect('sent');
}
function unsupported(){return new NextResponse(null,{status:405,headers:{...Object.fromEntries(privateHeaders()),Allow:'POST'}});}
export const GET=unsupported,HEAD=unsupported,PUT=unsupported,DELETE=unsupported,PATCH=unsupported,OPTIONS=unsupported;
