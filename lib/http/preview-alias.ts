import 'server-only';
import {NextResponse,type NextRequest} from 'next/server.js';
import {applyPrivateResponseHeaders} from './private-response.ts';

/** Move navigation to the exact build URL before cookies or credentials are used.
 * The branch alias is routing metadata, never evidence authorizing a mutation.
 */
export function previewAliasResponse(request: NextRequest, canonicalOrigin: string, aliasOrigin: string): NextResponse|null {
  if (!aliasOrigin || aliasOrigin===canonicalOrigin) return null;
  // Next can construct nextUrl from an internal listener. Host is used only to
  // select a fixed safe redirect/rejection, never to establish mutation trust.
  if (request.nextUrl.origin!==aliasOrigin && request.headers.get('host')!==new URL(aliasOrigin).host) return null;
  const headers=new Headers();
  applyPrivateResponseHeaders(headers);
  headers.set('Referrer-Policy','no-referrer');
  if (!['GET','HEAD'].includes(request.method) || ['/auth/confirm','/auth/confirm/'].includes(request.nextUrl.pathname)) {
    return new NextResponse(null,{status:403,headers});
  }
  const destination=new URL(canonicalOrigin);
  destination.pathname=request.nextUrl.pathname;
  // Do not transport token/query values across hostnames. Start a fresh session.
  headers.set('Location',destination.href);
  return new NextResponse(null,{status:303,headers});
}
