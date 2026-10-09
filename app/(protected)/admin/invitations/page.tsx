import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import {listAdminInvitations} from '../../../../lib/auth/invitation-admin-query';
import AppShell from '../../_components/app-shell';
import AccessState from '../../_components/access-state';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Invitations | Volo',description:'Admin invitation status.'};

export default async function InvitationsPage(){
 const result=await listAdminInvitations();
 if(result.status==='unauthenticated')redirect('/login?reason=authentication-required');
 if(result.status!=='authorized')return <AccessState status={result.status} retryHref="/admin/invitations"/>;
 return <AppShell isAdmin>
  <header className="space-y-3">
   <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Invitations</h1>
   <p className="text-zinc-600 dark:text-zinc-400">Latest 50 invitations, newest first. Accepted for sending does not confirm delivery.</p>
  </header>
  <section aria-label="Invitation list" className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
   {result.rows.length===0?<p>No invitations yet.</p>:<div className="overflow-x-auto">
    <table className="w-full text-left text-sm">
     <caption className="sr-only">Invitation status and current send outcome</caption>
     <thead><tr className="border-b border-zinc-200 dark:border-zinc-800">
      {['Recipient','Invitation status','Send state','Last update (UTC)'].map(label=><th key={label} scope="col" className="px-3 py-3 font-semibold">{label}</th>)}
     </tr></thead>
     <tbody>{result.rows.map(row=><tr key={row.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
      <td className="break-all px-3 py-4">{row.email}</td>
      <td className="px-3 py-4">{row.invitationStatus}</td>
      <td className="px-3 py-4">{row.sendStatus}</td>
      <td className="whitespace-nowrap px-3 py-4"><time dateTime={row.updatedAt}>{new Date(row.updatedAt).toISOString().replace('T',' ').slice(0,16)}</time></td>
     </tr>)}</tbody>
    </table>
   </div>}
   {result.hasMore&&<p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">Older invitations are not shown.</p>}
  </section>
 </AppShell>;
}
