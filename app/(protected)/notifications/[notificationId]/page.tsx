import type {Metadata} from 'next';
import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getPageAccess} from '../../../../lib/auth/page-access';
import {getNotificationDestination} from '../../../../lib/notifications/destination';
import AppShell from '../../_components/app-shell';
import AccessState from '../../_components/access-state';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Notification | Volo',robots:{index:false,follow:false}};
const linkClass='inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4';
export default async function NotificationTargetPage({params}:{params:Promise<{notificationId:string}>}){
 const access=await getPageAccess();if(access.status!=='authorized')return <AccessState status={access.status} retryHref="/notifications"/>;
 const {notificationId}=await params,result=await getNotificationDestination(notificationId);
 if(result.status==='unauthenticated')redirect('/login?reason=authentication-required');
 if(result.status==='forbidden')return <AccessState status="forbidden"/>;
 if(result.status==='authorized')redirect(result.href);
 return <AppShell isAdmin={access.member.role==='admin'}>
  <section role={result.status==='unavailable'?'alert':undefined} className="space-y-3">
   <h1 className="text-3xl font-semibold">{result.status==='unavailable'?'Notification target temporarily unavailable':'Notification target unavailable'}</h1>
   <p>{result.status==='unavailable'?'We could not open this notification. Please try again.':'This notification or its destination is no longer available to this account.'}</p>
   {result.status==='unavailable'&&<form action={`/notifications/${encodeURIComponent(notificationId)}`} method="get"><button className={linkClass}>Try again</button></form>}
   <Link href="/notifications" prefetch={false} className={linkClass}>Back to notifications</Link>
  </section>
 </AppShell>;
}
