import type {Metadata} from 'next';
import Link from 'next/link';
import {redirect} from 'next/navigation';
import {Suspense} from 'react';
import {getPageAccess} from '../../../lib/auth/page-access';
import {listDirectoryProfiles} from '../../../lib/profiles/directory-query';
import AppShell from '../_components/app-shell';
import AccessState from '../_components/access-state';
import PilotCard from './pilot-card';

export const metadata:Metadata={title:'Pilot directory | Volo',description:'Meet pilots in the Volo network.',robots:{index:false,follow:false}};
const linkClass='inline-flex min-h-11 items-center rounded-lg px-4 py-2 font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4';

function DirectoryLoading(){
 return <div role="status" aria-live="polite" aria-busy="true" className="space-y-6">
  <p className="text-zinc-600 dark:text-zinc-400">Loading pilots…</p>
  <div aria-hidden="true" className="grid gap-6 sm:grid-cols-2">
   {[0,1,2,3].map(key=><div key={key} className="h-64 rounded-2xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"/>)}
  </div>
 </div>;
}

async function DirectoryListing({after}:{after:string|string[]|undefined}){
 const result=await listDirectoryProfiles(after===undefined?{}:{after});
 if(result.status!=='authorized'){
 if(result.status==='unauthenticated')redirect('/login?reason=authentication-required');
 if(result.status==='forbidden')return <section role="alert" className="space-y-4">
  <h2 className="text-xl font-semibold">Access denied</h2>
  <p>Your account does not currently have access to this workspace.</p>
 </section>;
 if(result.status==='invalid')return <section className="space-y-4" aria-labelledby="directory-state-heading">
  <h2 id="directory-state-heading" className="text-xl font-semibold">Invalid directory page</h2>
  <p className="text-zinc-600 dark:text-zinc-400">This page link is not valid. Start again from the first page.</p>
  <Link href="/directory" prefetch={false} className={linkClass}>Back to first page</Link>
 </section>;
  const validCursor=typeof after==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(after);
  return <section role="alert" className="space-y-4" aria-labelledby="directory-state-heading">
   <h2 id="directory-state-heading" className="text-xl font-semibold">Directory temporarily unavailable</h2>
   <p className="text-zinc-600 dark:text-zinc-400">We could not load the pilots. Please try again.</p>
   <a href={validCursor?`/directory?after=${encodeURIComponent(after)}`:'/directory'} className={linkClass}>Try again</a>
  </section>;
 }
 return <section className="space-y-6" aria-label="Directory results">
  {result.rows.length===0?<div className="space-y-3 rounded-2xl border border-zinc-200 p-6 sm:p-8 dark:border-zinc-800">
   <h2 className="text-xl font-semibold">{after?'No more pilots on this page':'No pilots to show yet'}</h2>
   <p className="text-zinc-600 dark:text-zinc-400">{after?'The directory may have changed since this link was created. Return to the first page to browse again.':'Pilots will appear here when their profiles are ready.'}</p>
  </div>:<>
   <p className="text-sm text-zinc-600 dark:text-zinc-400">{result.rows.length} {result.rows.length===1?'pilot':'pilots'} on this page</p>
   <ul aria-label="Pilots" className="grid gap-6 sm:grid-cols-2">
    {result.rows.map(pilot=><PilotCard key={pilot.user_id} pilot={pilot}/>)}
   </ul>
  </>}
  {(after||result.nextCursor)&&<nav aria-label="Directory pages" className="flex flex-wrap items-center justify-between gap-4">
   {after&&<Link href="/directory" prefetch={false} className={linkClass}>Back to first page</Link>}
   {result.nextCursor&&<Link href={`/directory?after=${result.nextCursor}`} prefetch={false} className={`${linkClass} ml-auto`}>Next page <span aria-hidden="true" className="ml-2">→</span></Link>}
  </nav>}
 </section>;
}

export default async function DirectoryPage({searchParams}:{searchParams:Promise<{[key:string]:string|string[]|undefined}>}){
 const access=await getPageAccess();
 if(access.status!=='authorized')return <AccessState status={access.status} retryHref="/directory"/>;
 const query=await searchParams;
 return <AppShell isAdmin={access.member.role==='admin'}>
  <header className="max-w-xl space-y-3">
   <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Pilot directory</h1>
   <p className="text-zinc-600 dark:text-zinc-400">Meet pilots in the Volo network. Profile details are self-reported.</p>
  </header>
  <Suspense fallback={<DirectoryLoading/>}><DirectoryListing after={query.after}/></Suspense>
 </AppShell>;
}
