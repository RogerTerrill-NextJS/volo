import type {Metadata} from 'next';
import {randomUUID} from 'node:crypto';
import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getPageAccess} from '../../../lib/auth/page-access';
import {getOwnReportReceipt} from '../../../lib/reports/query';
import {parseReportPage,reportHref} from '../../../lib/reports/links';
import AppShell from '../_components/app-shell';
import AccessState from '../_components/access-state';
import ReportForm from './form';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Report and support | Volo',robots:{index:false,follow:false}};
const linkClass='inline-flex min-h-11 w-fit items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4';
export default async function ReportsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const access=await getPageAccess();if(access.status!=='authorized')return <AccessState status={access.status} retryHref="/reports"/>;
 const input=parseReportPage(await searchParams);
 if(input.kind==='target'&&!input.reportId)redirect(reportHref(input.targetType,input.targetId,randomUUID())!);
 const receipt=input.kind==='target'?await getOwnReportReceipt(input.reportId):null;
 if(receipt?.status==='unauthenticated')redirect('/login?reason=authentication-required');
 if(receipt?.status==='forbidden')return <AccessState status="forbidden"/>;
 const conflict=receipt?.status==='authorized'&&receipt.report&&input.kind==='target'&&(receipt.report.target_type!==input.targetType||receipt.report.target_id!==input.targetId);
 return <AppShell isAdmin={access.member.role==='admin'}>
  <header className="space-y-3"><h1 className="text-3xl font-semibold">Report and support</h1><p>Raise a concern about a pilot, flight or message. The founder reviews reports manually during beta.</p><p>Sending a report does not block another pilot, close a conversation or change a flight. The founder decides whether further action is needed.</p></header>
  {input.kind==='invalid'||conflict?<section role="alert" className="space-y-3"><h2 className="text-xl font-semibold">This report link is unavailable</h2><p>Open the pilot, flight or message again and choose Report.</p><Link href="/reports" prefetch={false} className={linkClass}>Report help</Link></section>
   :input.kind==='landing'?<section className="space-y-4"><h2 className="text-xl font-semibold">Start from the item you want to report</h2><p>Choose Report this pilot on a pilot profile, Report this flight on a flight, or Report this message beside a message you can read. Describe what happened in the report form.</p><nav aria-label="Find an item to report" className="flex flex-wrap gap-6"><Link href="/directory" prefetch={false} className={linkClass}>Pilot directory</Link><Link href="/dashboard/flights" prefetch={false} className={linkClass}>Upcoming flights</Link><Link href="/messages" prefetch={false} className={linkClass}>Conversations</Link></nav></section>
   :receipt?.status!=='authorized'?<section role="alert" className="space-y-3"><h2 className="text-xl font-semibold">Report status temporarily unavailable</h2><p>We could not check this report. Check its status before sending.</p><Link href={reportHref(input.targetType,input.targetId,input.reportId!)!} prefetch={false} className={linkClass}>Check report status</Link></section>
   :<><section className="space-y-3"><h2 className="text-xl font-semibold">Report this {input.targetType}</h2><p>{input.targetType==='message'?'The message reference is included. Its body is not automatically copied into the report. Describe the relevant context for the founder.':'The item reference is included. Describe the concern for the founder.'}</p></section><ReportForm reportId={input.reportId!} targetType={input.targetType} targetId={input.targetId} receivedAt={receipt.report?.created_at??null}/></>}
 </AppShell>;
}
