import type {Metadata} from 'next';
import Link from '../../../_components/progress-link';
import {redirect} from 'next/navigation';
import {getPageAccess} from '../../../../lib/auth/page-access';
import {listAdminMembers} from '../../../../lib/auth/member-admin-query';
import {memberAdminUuid} from '../../../../lib/auth/member-admin-validation';
import AppShell from '../../_components/app-shell';
import AccessState from '../../_components/access-state';
import MemberControl from './control';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Members | Volo',robots:{index:false,follow:false}};
const linkClass='inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4';
const date=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'long',timeZone:'UTC'});
export default async function MembersPage({searchParams}:{searchParams:Promise<{after?:string|string[]}>}){
 const access=await getPageAccess();if(access.status!=='authorized')return <AccessState status={access.status} retryHref="/admin/members"/>;
 if(access.member.role!=='admin')return <AccessState status="forbidden"/>;
 const {after}=await searchParams,result=await listAdminMembers(after);
 if(result.status==='unauthenticated')redirect('/login?reason=authentication-required');
 if(result.status==='forbidden')return <AccessState status="forbidden"/>;
 if(result.status!=='authorized')return <AppShell isAdmin><section role={result.status==='unavailable'?'alert':undefined} className="space-y-4"><h1 className="text-3xl font-semibold">{result.status==='invalid'?'This member page is unavailable':'Members temporarily unavailable'}</h1><p>{result.status==='invalid'?'Open the first member page to continue.':'We could not load member status. No disable controls are available. Please try again.'}</p><form action="/admin/members" method="get">{result.status==='unavailable'&&typeof after==='string'&&memberAdminUuid.test(after)&&<input type="hidden" name="after" value={after}/>}<button className={linkClass}>Check member status</button></form></section></AppShell>;
 return <AppShell isAdmin>
  <header className="space-y-3"><h1 className="text-3xl font-semibold tracking-tight">Members</h1><p>Review membership status and disable protected access when necessary. Disabling preserves the account and retained data.</p><p className="text-sm">Up to 50 members per page, ordered by member ID. Role changes, account deletion and reactivation require a separate operator process.</p></header>
  <section aria-label="Member list" className="space-y-6">
   {!result.rows.length&&<p>{after?'No more members.':'No members to display.'}</p>}
   {result.rows.map(row=><article key={row.userId} id={'member-'+row.userId} tabIndex={-1} aria-labelledby={'name-'+row.userId} className="min-w-0 space-y-4 rounded-2xl border border-zinc-200 p-5 [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-4 sm:p-8">
    <h2 id={'name-'+row.userId} className="text-xl font-semibold">{row.displayName||'Member without a pilot profile'}{row.userId===access.member.userId?' (you)':''}</h2>
    <dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt className="font-medium">Member ID</dt><dd>{row.userId}</dd></div><div><dt className="font-medium">Role and status</dt><dd>{row.role==='admin'?'Administrator':'Member'} · {row.status==='active'?'Active':'Disabled'}</dd></div><div><dt className="font-medium">Joined</dt><dd><time dateTime={row.createdAt}>{date.format(new Date(row.createdAt))}</time></dd></div>{row.disabledAt&&<div><dt className="font-medium">Disabled</dt><dd><time dateTime={row.disabledAt}>{date.format(new Date(row.disabledAt))}</time></dd></div>}</dl>
    {row.status==='disabled'&&<div className="space-y-2"><h3 className="font-medium">Recorded reason</h3><p className="whitespace-pre-line">{row.disabledReason?.trim()?row.disabledReason:'No visible reason text.'}</p>{row.disabledReasonTruncated&&<p className="text-sm">Reason excerpt shown. An authorized operator can inspect the full record.</p>}</div>}
    {row.userId===access.member.userId?<p>You cannot disable your own account.</p>:<>{row.role==='admin'&&row.status==='active'&&<p>Disabling this administrator also removes their administration access.</p>}<MemberControl targetId={row.userId} disabled={row.status==='disabled'} after={typeof after==='string'?after:undefined}/></>}
   </article>)}
  </section>
  <nav aria-label="Member pages" className="flex flex-wrap gap-6">{after&&<Link href="/admin/members" prefetch={false} className={linkClass}>First member page</Link>}{result.nextCursor&&<Link href={'/admin/members?after='+result.nextCursor} prefetch={false} className={linkClass}>Next members</Link>}</nav>
 </AppShell>;
}
