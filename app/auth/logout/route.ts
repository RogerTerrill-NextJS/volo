import {NextResponse,type NextRequest} from 'next/server';
import {cookies} from 'next/headers';
import {createServerSupabaseClient} from '../../../lib/supabase/server.ts';
import {getSupabasePublicConfig} from '../../../lib/supabase/public-config.mjs';
import {createProxyAuthTransport} from '../../../lib/supabase/proxy-auth.ts';
import {checkMutationOrigin} from '../../../lib/auth/mutation-request.ts';
import {parseMutationOrigin} from '../../../lib/auth/mutation-origin.mjs';
import {confirmationCookieNames} from '../../../lib/auth/invitation-setup.ts';
import {applyPrivateResponseHeaders} from '../../../lib/http/private-response.ts';

export const runtime='nodejs';
function privateHeaders(){const headers=new Headers();applyPrivateResponseHeaders(headers);headers.set('Referrer-Policy','no-referrer');return headers;}
export async function POST(request:NextRequest){
 const headers=privateHeaders();let origin:string;
 try{origin=parseMutationOrigin(process.env.VOLO_MUTATION_ORIGIN??'',true);}
 catch{return new NextResponse(null,{status:503,headers});}
 if(checkMutationOrigin(request.headers,origin)!==null)return new NextResponse(null,{status:403,headers});
 if(request.nextUrl.search)return new NextResponse(null,{status:400,headers});
 // Logout takes no application input or caller-supplied destination.
 void request.body?.cancel().catch(()=>{});
 let transport:ReturnType<typeof createProxyAuthTransport>|undefined;
 try{
  const store=await cookies(),base='sb-'+new URL(getSupabasePublicConfig().url).hostname.split('.')[0]+'-auth-token';
  const owned=(name:string)=>name===base||(name.startsWith(base)&&/^(?:\.\d+|-code-verifier(?:\.\d+)?|-flows-code-verifier(?:\.\d+)?|-flow-[A-Za-z0-9_-]+-code-verifier(?:\.\d+)?)$/.test(name.slice(base.length)));
  const original=store.getAll().filter(cookie=>owned(cookie.name)).map(cookie=>cookie.name);
  const names=confirmationCookieNames(origin);let unavailable=false;
  try{
   transport=createProxyAuthTransport();
   const client=await createServerSupabaseClient({cookieMode:'read-write',fetch:transport.fetch,setResponseHeaders(updates){for(const [key,value] of Object.entries(updates))headers.set(key,value);applyPrivateResponseHeaders(headers);headers.set('Referrer-Policy','no-referrer');}});
   const {error}=await client.auth.signOut({scope:'local'});unavailable=Boolean(error)||transport.isUnavailable();
  }catch{unavailable=true;}
  finally{
   // The SDK may fail before cleanup (for example during refresh). Always remove
   // this browser's auth/setup authority, including old cookie chunks.
   for(const name of new Set([...original,...store.getAll().filter(cookie=>owned(cookie.name)).map(cookie=>cookie.name),names.setup,names.confirmation,names.recovery])){
    store.set(name,'',{path:'/',secure:names.secure,sameSite:'lax',maxAge:0,httpOnly:true});
   }
  }
  return new NextResponse(null,{status:303,headers:new Headers([...headers,['Location',new URL(unavailable?'/login?result=logout_unavailable':'/login?result=signed_out',origin).href]])});
 }catch{return new NextResponse(null,{status:503,headers});}
 finally{transport?.close();}
}
function unsupported(){return new NextResponse(null,{status:405,headers:{...Object.fromEntries(privateHeaders()),Allow:'POST'}});}
export const GET=unsupported,HEAD=unsupported,PUT=unsupported,DELETE=unsupported,PATCH=unsupported,OPTIONS=unsupported;
