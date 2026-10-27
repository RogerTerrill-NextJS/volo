import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import {getPageAccess} from '../../../../lib/auth/page-access';
import {getMvpMetrics,type MetricsReport} from '../../../../lib/metrics/query';
import AppShell from '../../_components/app-shell';
import AccessState from '../../_components/access-state';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'MVP metrics | Volo',robots:{index:false,follow:false}};
const fields:[keyof Omit<MetricsReport,'asOf'|'outcomes'>,string,string][]=[
 ['outcomeResponses','Participant outcome responses','Latest Yes/No answers, one per authenticated participant per accepted request. Corrections reuse the row. Unanswered is not No.'],
 ['confirmedConnections','Connections with at least one Yes','Distinct accepted request IDs with one or both participants reporting Yes. Self-reported, not independently verified; later closure does not erase historical responses.'],
 ['oneParticipantConfirmed','Connections with exactly one Yes','Exactly one participant reports Yes; the other may be unanswered or report No. Conflicting answers are also counted separately below.'],
 ['bothParticipantsConfirmed','Connections with both Yes','Both participants report Yes for the same accepted request. Two answers count one connection.'],
 ['conflictingConnections','Connections with conflicting answers','One participant reports Yes and the other No. These are included in the exactly-one-Yes count; no automatic adjudication.'],
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
   <dl className="grid gap-4 sm:grid-cols-2">{fields.map(([key,label,description])=><div key={key} className="space-y-3 rounded-2xl border border-zinc-200 p-5"><dt className="font-semibold">{label}</dt><dd className="text-3xl font-semibold tabular-nums">{result.report[key].toLocaleString('en-US')}</dd><dd className="text-sm text-zinc-600">{description}</dd></div>)}</dl>
   <section aria-labelledby="outcomes-heading" className="space-y-3"><h2 id="outcomes-heading" className="text-xl font-semibold">Participant-reported flying outcomes</h2><p>Acceptances and messages do not prove pilots flew together. Optional Yes/No answers become available after the scheduled local flight date. Connections are unique accepted request records, not unique pilot pairs across flights. These retained-record gauges can change when a pilot corrects an answer; they are not verified flight totals or a cohort conversion rate.</p></section>
   <form action="/admin/metrics" method="get"><button className={buttonClass}>Reload metrics</button></form>
  </>}
 </AppShell>;
}
