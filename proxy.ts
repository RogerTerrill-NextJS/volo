import {NextResponse} from "next/server.js";
import {setupResultMessage} from "./lib/auth/invitation-setup-feedback.ts";
import {passwordRecoveryMessage} from './lib/auth/password-recovery-feedback.ts';
import {passwordResetMessage} from './lib/auth/password-reset-feedback.ts';
import {loginResultMessage} from './lib/auth/login-feedback.ts';
import {parseMutationOrigin} from "./lib/auth/mutation-origin.mjs";
import {applyPrivateResponseHeaders} from "./lib/http/private-response.ts";
import type { NextRequest } from "next/server.js";
import { refreshSupabaseSession } from "./lib/supabase/proxy.ts";

export async function proxy(request: NextRequest) {
  if (["/reset-password","/reset-password/"].includes(request.nextUrl.pathname)) {
    const query=request.nextUrl.searchParams,results=query.getAll('result'),headers=new Headers();applyPrivateResponseHeaders(headers);headers.set('Referrer-Policy','no-referrer');
    if([...query.keys()].some(key=>!['result','_rsc'].includes(key))||results.length>1||(results.length===1&&!passwordResetMessage(results[0]))){
      try{headers.set('Location',new URL('/reset-password?result=invalid_input',parseMutationOrigin(process.env.VOLO_MUTATION_ORIGIN??'',true)).href);}
      catch{return new NextResponse(null,{status:503,headers});}
      return new NextResponse(null,{status:303,headers});
    }
    const {response}=await refreshSupabaseSession(request);for(const [key,value] of headers)response.headers.set(key,value);return response;
  }
  if (["/forgot-password","/forgot-password/"].includes(request.nextUrl.pathname)) {
    const query=request.nextUrl.searchParams,results=query.getAll('result'),headers=new Headers();
    applyPrivateResponseHeaders(headers);headers.set('Referrer-Policy','no-referrer');
    if([...query.keys()].some(key=>!['result','_rsc'].includes(key))||results.length>1||(results.length===1&&!passwordRecoveryMessage(results[0]))){
      try{headers.set('Location',new URL('/forgot-password?result=invalid_input',parseMutationOrigin(process.env.VOLO_MUTATION_ORIGIN??'',true)).href);}
      catch{return new NextResponse(null,{status:503,headers});}
      return new NextResponse(null,{status:303,headers});
    }
    // Public recovery initiation must not refresh, clear or require a visitor session.
    const response=NextResponse.next();for(const [key,value] of headers)response.headers.set(key,value);return response;
  }
  if (["/login","/login/"].includes(request.nextUrl.pathname)) {
    const query=request.nextUrl.searchParams,results=query.getAll('result'),reasons=query.getAll('reason');
    if([...query.keys()].some(key=>!['result','reason','_rsc'].includes(key))||results.length>1||reasons.length>1
      ||(results.length===1&&!loginResultMessage(results[0]))||(reasons.length===1&&reasons[0]!=='authentication-required')){
      const headers=new Headers();applyPrivateResponseHeaders(headers);headers.set('Referrer-Policy','no-referrer');
      try{headers.set('Location',new URL('/login?result=invalid_input',parseMutationOrigin(process.env.VOLO_MUTATION_ORIGIN??'',true)).href);}
      catch{return new NextResponse(null,{status:503,headers});}
      return new NextResponse(null,{status:303,headers});
    }
  }
  if (["/account/setup","/account/setup/"].includes(request.nextUrl.pathname)) {
    const query=request.nextUrl.searchParams,results=query.getAll("result");
    if ([...query.keys()].some(key=>!["result","_rsc"].includes(key)) || results.length>1 || (results.length===1&&!setupResultMessage(results[0]))) {
      const headers=new Headers();applyPrivateResponseHeaders(headers);headers.set("Referrer-Policy","no-referrer");
      try {headers.set("Location",new URL("/account/setup?result=invalid_input",parseMutationOrigin(process.env.VOLO_MUTATION_ORIGIN??"",true)).href);}
      catch {return new NextResponse(null,{status:503,headers});}
      return new NextResponse(null,{status:303,headers});
    }
  }
  return (await refreshSupabaseSession(request)).response;
}

export const config = {
  matcher: ["/((?!auth/confirm/?$|auth/login/?$|auth/logout/?$|auth/recovery/?$|auth/reset-password/?$|account/complete/?$|_next/static(?:/|$)|_next/image(?:/|$)|api/health/?$|(?:favicon\\.ico|robots\\.txt|sitemap\\.xml|file\\.svg|globe\\.svg|next\\.svg|vercel\\.svg|window\\.svg)$).*)"],
};
