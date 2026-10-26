import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import {getPageAccess} from '../../../../lib/auth/page-access';
import {getMvpMetrics,type MetricsReport} from '../../../../lib/metrics/query';
import AppShell from '../../_components/app-shell';
import AccessState from '../../_components/access-state';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'MVP metrics | Volo',robots:{index:false,follow:false}};
const fields:[keyof Omit<MetricsReport,'asOf'|'outcomes'>,string,string][]=[
 ['invitedPilots','Invited pilots','Distinct normalized invitation recipients with an accepted provider send receipt or accepted reconciliation. This confirms provider acceptance, not email delivery.'],
 ['activatedPilots','Activated pilots','Distinct subjects with a redeemed invitation. Bootstrap and other direct admissions are excluded.'],
 ['activeMembers','Active members','Currently active memberships, including bootstrap admissions. Disabled members are excluded.'],
 ['completedProfiles','Completed profiles','All retained profiles; required fields are enforced when saved. Disabled members remain in this historical count.'],
 ['activeProfiles','Active profiles','Completed profiles belonging to currently active members.'],
 ['flightPosts','Flight posts','All retained posts, including private, hidden, cancelled and completed flights.'],
 ['interestRequests','Interest requests','Unique flight/requester records across all states. Withdrawal and eligible resubmission reuse one record.'],
 ['currentAcceptedRequests','Current accepted requests','Requests whose current status is accepted. This count can decrease after withdrawal or cancellation.'],
 ['recordedAcceptedRequests','Requests with recorded acceptance','Distinct requests with current acceptance, an acceptance notification or a conversation. Reacceptance counts once. Earlier closed requests without retained evidence cannot be reconstructed.'],
 ['messages','Messages','Unique retained messages, including closed conversation history. Exact send retries count once.'],
 ['messagingConversations','Conversations with messages','Distinct conversations containing at least one message. This does not confirm a flight took place.'],
];
const buttonClass='inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4';
export default async function MvpMetricsPage(){
 const access=await getPageAccess();if(access.status!=='authorized')return <AccessState status={access.status} retryHref="/admin/metrics"/>;
 if(access.member.role!=='admin')return <AccessState status="forbidden"/>;
 const result=await getMvpMetrics();if(result.status==='unauthenticated')redirect('/login?reason=authentication-required');
 if(result.status==='forbidden')return <AccessState status="forbidden"/>;
 return <AppShell isAdmin>
  <header className="space-y-3"><h1 className="text-3xl font-semibold">MVP metrics</h1><p>Admin-only aggregate counts from existing records. No private profile, flight or message content is included.</p><p>These are all-time retained-record totals and current-state counts, not a cohort conversion funnel. Each definition below explains its population.</p></header>
  {result.status==='unavailable'?<section role="alert" className="space-y-3"><h2 className="text-xl font-semibold">Metrics temporarily unavailable</h2><p>We could not load the report. Please try again.</p><form action="/admin/metrics" method="get"><button className={buttonClass}>Reload metrics</button></form></section>:<>
   <p className="text-sm">Snapshot <time dateTime={result.report.asOf}>{new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'long',timeZone:'UTC'}).format(new Date(result.report.asOf))} (UTC)</time></p>
   <dl className="grid gap-4 sm:grid-cols-2">{fields.map(([key,label,description])=><div key={key} className="space-y-3 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800"><dt className="font-semibold">{label}</dt><dd className="text-3xl font-semibold tabular-nums">{result.report[key].toLocaleString('en-US')}</dd><dd className="text-sm text-zinc-600 dark:text-zinc-400">{description}</dd></div>)}</dl>
   <section aria-labelledby="outcomes-heading" className="space-y-3"><h2 id="outcomes-heading" className="text-xl font-semibold">Real-world flying outcomes: not collected</h2><p>Acceptances and messages do not prove pilots flew together. No participant-confirmed connection count or one/both-participant confirmation is available yet. Optional participant confirmation is needed before real-world outcomes can be reported.</p></section>
   <form action="/admin/metrics" method="get"><button className={buttonClass}>Reload metrics</button></form>
  </>}
 </AppShell>;
}
