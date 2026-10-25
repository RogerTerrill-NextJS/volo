import type {Metadata} from 'next';
import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getPageAccess} from '../../../lib/auth/page-access';
import {listConversations} from '../../../lib/messages/list-query';
import AppShell from '../_components/app-shell';
import AccessState from '../_components/access-state';
export const metadata:Metadata={title:'Messages | Volo',robots:{index:false,follow:false}};
const linkClass='inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4';
export default async function MessagesPage({searchParams}:{searchParams:Promise<{after?:string|string[]}>}){
 const access=await getPageAccess();if(access.status!=='authorized')return <AccessState status={access.status} retryHref="/messages"/>;
 const result=await listConversations((await searchParams).after);
 if(result.status==='unauthenticated')redirect('/login?reason=authentication-required');
 if(result.status==='forbidden')return <AccessState status="forbidden"/>;
 return <AppShell isAdmin={access.member.role==='admin'}>
  <header className="space-y-3"><h1 className="text-3xl font-semibold tracking-tight">Messages</h1><p>Your private conversations from accepted flight requests.</p></header>
  {result.status==='unavailable'?<section role="alert" className="space-y-3"><h2 className="text-xl font-semibold">Conversations temporarily unavailable</h2><p>We could not load your conversations. Please try again.</p><form action="/messages" method="get"><button className={linkClass}>Try again</button></form></section>:result.status==='invalid'?<section className="space-y-3"><h2 className="text-xl font-semibold">This conversation page is unavailable</h2><Link href="/messages" prefetch={false} className={linkClass}>Back to latest conversations</Link></section>:<>
   <p className="text-sm text-zinc-600 dark:text-zinc-400">Newest conversations first.</p>
   {result.rows.length?<ul aria-label="Conversations" className="space-y-4">{result.rows.map(row=><li key={row.id} className="min-w-0 space-y-3 rounded-2xl border border-zinc-200 p-5 [overflow-wrap:anywhere] dark:border-zinc-800">
    <h2 className="text-xl font-semibold">{row.pilotName||'Pilot profile unavailable'}</h2>
    <p>{row.flight?`${row.flight.departure} → ${row.flight.destination}`:'Flight details are no longer available to this account.'}</p>
    {row.closed&&<p className="text-sm font-medium">Conversation closed · History retained</p>}
    <p className="text-zinc-600 dark:text-zinc-400">{row.preview||'No messages yet.'}</p>
    <p className="text-sm">Started <time dateTime={row.createdAt}>{new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(row.createdAt))} (UTC)</time></p>
    <Link href={`/dashboard/connections/${row.requestId}`} prefetch={false} className={linkClass}>View flight connection<span className="sr-only"> with {row.pilotName||'pilot'}</span></Link>
   </li>)}</ul>:<section className="space-y-3"><h2 className="text-xl font-semibold">{(await searchParams).after?'No older conversations':'No conversations yet'}</h2><p>Conversations appear here after an accepted flight request opens a conversation.</p><Link href="/dashboard/flights" prefetch={false} className={linkClass}>Browse upcoming flights</Link></section>}
   <nav aria-label="Conversation pages" className="flex flex-wrap gap-6">{(await searchParams).after&&<Link href="/messages" prefetch={false} className={linkClass}>Back to latest conversations</Link>}{result.nextCursor&&<Link href={`/messages?after=${encodeURIComponent(result.nextCursor)}`} prefetch={false} className={linkClass}>Older conversations</Link>}</nav>
  </>}
 </AppShell>;
}
