import {NextResponse} from "next/server.js";
import {setupResultMessage} from "./lib/auth/invitation-setup-feedback.ts";
import {loginResultMessage} from './lib/auth/login-feedback.ts';
import {parseMutationOrigin} from "./lib/auth/mutation-origin.mjs";
import {applyPrivateResponseHeaders} from "./lib/http/private-response.ts";
import type { NextRequest } from "next/server.js";
import { refreshSupabaseSession } from "./lib/supabase/proxy.ts";

export async function proxy(request: NextRequest) {
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
  matcher: ["/((?!auth/confirm/?$|auth/login/?$|account/complete/?$|_next/static(?:/|$)|_next/image(?:/|$)|api/health/?$|(?:favicon\\.ico|robots\\.txt|sitemap\\.xml|file\\.svg|globe\\.svg|next\\.svg|vercel\\.svg|window\\.svg)$).*)"],
};
