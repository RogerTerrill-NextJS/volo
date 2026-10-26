import type {Metadata} from 'next';
import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getPageAccess} from '../../../lib/auth/page-access';
import {listNotifications} from '../../../lib/notifications/query';
import AppShell from '../_components/app-shell';
import AccessState from '../_components/access-state';
import MarkRead from './mark-read';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Notifications | Volo',robots:{index:false,follow:false}};
const labels={request_received:'New flight request',request_accepted:'Flight request accepted',message_received:'New message'};
const targetLabels={request_received:'View flight requests',request_accepted:'View connection',message_received:'Open conversation'};
const linkClass='inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4';
export default async function NotificationsPage({searchParams}:{searchParams:Promise<{after?:string|string[]}>}){
 const access=await getPageAccess();if(access.status!=='authorized')return <AccessState status={access.status} retryHref="/notifications"/>;
 const after=(await searchParams).after,result=await listNotifications(after);
 if(result.status==='unauthenticated')redirect('/login?reason=authentication-required');
 if(result.status==='forbidden')return <AccessState status="forbidden"/>;
 const permalink=typeof after==='string'?`/notifications?after=${encodeURIComponent(after)}`:'/notifications';
 return <AppShell isAdmin={access.member.role==='admin'}>
  <header className="space-y-3"><h1 className="text-3xl font-semibold tracking-tight">Notifications</h1><p>Flight requests, acceptances and messages for your account.</p><p className="text-sm text-zinc-600 dark:text-zinc-400">Newest first. Notifications stay unread until you mark them as read.</p></header>
  {result.status==='unavailable'?<section role="alert" className="space-y-3"><h2 className="text-xl font-semibold">Notifications temporarily unavailable</h2><p>We could not load your notifications. Please try again.</p><form action="/notifications" method="get"><button className={linkClass}>Try again</button></form></section>:result.status==='invalid'?<section className="space-y-3"><h2 className="text-xl font-semibold">This notification page is unavailable</h2><Link href="/notifications" prefetch={false} className={linkClass}>Back to latest notifications</Link></section>:<>
   {result.rows.length?<ul aria-label="Notifications" className="space-y-4">{result.rows.map(row=><li key={row.id} className="min-w-0 space-y-3 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
    <h2 className="text-xl font-semibold">{labels[row.eventType]}</h2><p className="text-sm font-medium">{row.readAt?'Read':'Unread'}</p>
    <p className="text-sm">Received <time dateTime={row.createdAt}>{new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(row.createdAt))} (UTC)</time></p>
    <Link href={`/notifications/${row.id}`} prefetch={false} className={linkClass}>{targetLabels[row.eventType]}</Link>
    {!row.readAt&&<MarkRead id={row.id} permalink={permalink}/>}
   </li>)}</ul>:<section className="space-y-3"><h2 className="text-xl font-semibold">{after?'No older notifications':'No notifications yet'}</h2><p>New flight requests, acceptances and messages will appear here.</p></section>}
   <nav aria-label="Notification pages" className="flex flex-wrap gap-6">{after&&<Link href="/notifications" prefetch={false} className={linkClass}>Back to latest notifications</Link>}{result.nextCursor&&<Link href={`/notifications?after=${encodeURIComponent(result.nextCursor)}`} prefetch={false} className={linkClass}>Older notifications</Link>}</nav>
  </>}
 </AppShell>;
}
