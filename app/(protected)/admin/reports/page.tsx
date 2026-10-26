import type {Metadata} from 'next';
import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getPageAccess} from '../../../../lib/auth/page-access';
import {listFounderReports} from '../../../../lib/reports/query';
import AppShell from '../../_components/app-shell';
import AccessState from '../../_components/access-state';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Reports | Volo',robots:{index:false,follow:false}};
const linkClass='inline-flex min-h-11 w-fit items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4';
const timestamp=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'long',timeZone:'UTC'});
export default async function FounderReportsPage({searchParams}:{searchParams:Promise<{after?:string|string[]}>}){
 const access=await getPageAccess();if(access.status!=='authorized')return <AccessState status={access.status} retryHref="/admin/reports"/>;
 if(access.member.role!=='admin')return <AccessState status="forbidden"/>;
 const {after}=await searchParams,result=await listFounderReports(after);
 if(result.status==='unauthenticated')redirect('/login?reason=authentication-required');
 if(result.status==='forbidden')return <AccessState status="forbidden"/>;
 if(result.status!=='authorized')return <AppShell isAdmin><section role={result.status==='unavailable'?'alert':undefined} className="space-y-3"><h1 className="text-3xl font-semibold">{result.status==='invalid'?'This report page is unavailable':'Reports temporarily unavailable'}</h1><p>Open the first report page or try again.</p><Link href="/admin/reports" prefetch={false} className={linkClass}>First report page</Link></section></AppShell>;
 return <AppShell isAdmin>
  <header className="space-y-3"><h1 className="text-3xl font-semibold">Reports</h1><p>Manual beta intake, up to 50 reports per page, ordered by report reference. A report is a concern to review, not a verified finding or an automatic moderation action.</p><p>Message references do not grant access to private conversations. Reports include only the reference and the reporter’s own description.</p><details className="space-y-3"><summary className="min-h-11 cursor-pointer py-2 font-medium">Founder handling guide</summary><ol className="list-decimal space-y-3 pl-6"><li>Review the concern and verify the correct target using information you are entitled to read. The reporter is not automatically the reported pilot.</li><li>Seek only the minimum additional context through an agreed support channel. A message reference does not authorize a conversation lookup.</li><li>Choose no action, clarification, member disable or flight hide as warranted. Use the existing controls with an explicit reason and confirmation, then verify the result.</li><li>Record the report reference, decision, evidence limits and any audit reference in restricted founder notes. Reports remain unchanged; there is no resolved marker or automatic reply.</li></ol></details><nav aria-label="Founder handling controls" className="flex flex-wrap gap-6"><Link href="/admin/members" prefetch={false} className={linkClass}>Member controls</Link><Link href="/admin/flights" prefetch={false} className={linkClass}>Flight moderation</Link></nav></header>
  <section aria-label="Report list" className="space-y-6">{!result.rows.length&&<p>{after?'No more reports.':'No reports received.'}</p>}
   {result.rows.map(row=><article key={row.id} id={'report-'+row.id} className="min-w-0 space-y-4 rounded-2xl border border-zinc-200 p-5 [overflow-wrap:anywhere]"><h2 className="text-xl font-semibold">{row.target_type==='pilot'?'Pilot':row.target_type==='flight'?'Flight':'Message'} report</h2><dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt className="font-medium">Report reference</dt><dd>{row.id}</dd></div><div><dt className="font-medium">Received</dt><dd><time dateTime={row.created_at}>{timestamp.format(new Date(row.created_at))}</time></dd></div><div><dt className="font-medium">Reporter member ID</dt><dd>{row.reporter_id}</dd></div><div><dt className="font-medium">Reported {row.target_type} ID</dt><dd>{row.target_id}</dd></div></dl><p className="whitespace-pre-wrap">{row.reason}</p></article>)}
  </section>
  <nav aria-label="Report pages" className="flex flex-wrap gap-6">{after&&<Link href="/admin/reports" prefetch={false} className={linkClass}>First report page</Link>}{result.nextCursor&&<Link href={'/admin/reports?after='+result.nextCursor} prefetch={false} className={linkClass}>Next reports</Link>}</nav>
 </AppShell>;
}
