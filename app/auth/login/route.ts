import {NextResponse,type NextRequest} from 'next/server';
import {createServerSupabaseClient} from '../../../lib/supabase/server.ts';
import {AUTH_CREDENTIAL_CODES,createProxyAuthTransport} from '../../../lib/supabase/proxy-auth.ts';
import {checkMutationOrigin} from '../../../lib/auth/mutation-request.ts';
import {parseMutationOrigin} from '../../../lib/auth/mutation-origin.mjs';
import {readLoginInput} from '../../../lib/auth/login-input.ts';
import {applyPrivateResponseHeaders} from '../../../lib/http/private-response.ts';

export const runtime='nodejs';
const rejectedCredentials=new Set([...AUTH_CREDENTIAL_CODES,'invalid_credentials','email_not_confirmed','validation_failed']);
function privateHeaders(){const headers=new Headers();applyPrivateResponseHeaders(headers);headers.set('Referrer-Policy','no-referrer');return headers;}
export async function POST(request:NextRequest){
 const headers=privateHeaders();let transport:ReturnType<typeof createProxyAuthTransport>|undefined,origin:string;
 try{origin=parseMutationOrigin(process.env.VOLO_MUTATION_ORIGIN??'',true);}
 catch{return new NextResponse(null,{status:503,headers});}
 const redirect=(path:string)=>new NextResponse(null,{status:303,headers:new Headers([...headers,['Location',new URL(path,origin).href]])});
 if(checkMutationOrigin(request.headers,origin)!==null)return new NextResponse(null,{status:403,headers});
 try{
  if(request.nextUrl.search)return redirect('/login?result=invalid_input');
  const input=await readLoginInput(request);if(!input)return redirect('/login?result=invalid_input');
  transport=createProxyAuthTransport(rejectedCredentials);
  const client=await createServerSupabaseClient({cookieMode:'read-write',fetch:transport.fetch,setResponseHeaders(updates){for(const [key,value] of Object.entries(updates))headers.set(key,value);applyPrivateResponseHeaders(headers);headers.set('Referrer-Policy','no-referrer');}});
  const {data,error}=await client.auth.signInWithPassword(input);
  if(transport.isUnavailable())return redirect('/login?result=unavailable');
  if(error)return redirect(rejectedCredentials.has(error.code??'')?'/login?result=invalid_credentials':'/login?result=unavailable');
  if(!data.user||!data.session)return redirect('/login?result=unavailable');
  // Native navigation performs a fresh request; dashboard independently verifies membership.
  return redirect('/dashboard');
 }catch{return redirect('/login?result=unavailable');}finally{transport?.close();}
}
function unsupported(){return new NextResponse(null,{status:405,headers:{...Object.fromEntries(privateHeaders()),Allow:'POST'}});}
export const GET=unsupported,HEAD=unsupported,PUT=unsupported,DELETE=unsupported,PATCH=unsupported,OPTIONS=unsupported;
