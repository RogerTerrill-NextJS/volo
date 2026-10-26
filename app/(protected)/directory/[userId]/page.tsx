import type {Metadata} from 'next';
import Link from 'next/link';
import {reportHref} from '../../../../lib/reports/links';
import {notFound,redirect} from 'next/navigation';
import {getPageAccess} from '../../../../lib/auth/page-access';
import {getNetworkProfile} from '../../../../lib/profiles/directory-query';
import AppShell from '../../_components/app-shell';
import AccessState from '../../_components/access-state';
import ProfilePhoto from '../../_components/profile-photo';
import PilotDetails from '../../_components/pilot-details';

export const metadata:Metadata={title:'Pilot profile | Volo',robots:{index:false,follow:false}};
const linkClass='inline-flex min-h-11 w-fit items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4';

export default async function NetworkProfilePage({params}:{params:Promise<{userId:string}>}){
 const access=await getPageAccess();
 if(access.status!=='authorized')return <AccessState status={access.status} retryHref="/directory"/>;
 const {userId}=await params;
 const result=await getNetworkProfile(userId);
 if(result.status!=='authorized'){
  if(result.status==='unauthenticated')redirect('/login?reason=authentication-required');
  if(result.status==='forbidden')return <AccessState status="forbidden"/>;
  if(result.status==='missing')notFound();
  return <AppShell isAdmin={access.member.role==='admin'}>
   <section className="space-y-4" role="alert" aria-labelledby="profile-state-heading">
    <h1 id="profile-state-heading" className="text-3xl font-semibold tracking-tight">Profile temporarily unavailable</h1>
    <p className="text-zinc-600">We could not load this pilot profile. Please try again.</p>
    <a href={`/directory/${encodeURIComponent(userId)}`} className={linkClass}>Try again</a>
   </section>
   <Link href="/directory" prefetch={false} className={linkClass}>Back to directory</Link>
  </AppShell>;
 }
 const pilot=result.profile;
 return <AppShell isAdmin={access.member.role==='admin'}>
  <Link href="/directory" prefetch={false} className={linkClass}><span aria-hidden="true" className="mr-2">←</span>Back to directory</Link>
  <article aria-labelledby="pilot-name" className="min-w-0 space-y-8 rounded-2xl border border-zinc-200 bg-white p-6 [overflow-wrap:anywhere] sm:p-8">
   <header className="flex flex-wrap items-center gap-6 border-b border-zinc-200 pb-8">
    <ProfilePhoto userId={pilot.user_id} displayName={pilot.display_name} available={pilot.photoAvailable}/>
    <div className="min-w-0 flex-1 space-y-2">
     <h1 id="pilot-name" className="text-3xl font-semibold tracking-tight sm:text-4xl">{pilot.display_name}</h1>
     <p className="text-zinc-600">Licensed pilot</p>
    </div>
   </header>
   <p className="text-sm text-zinc-600">Profile details are self-reported.</p>
   <PilotDetails pilot={pilot} className="grid gap-6 sm:grid-cols-2"/>
   <Link href={reportHref('pilot',pilot.user_id)??'/reports'} prefetch={false} className={linkClass}>Report this pilot</Link>
  </article>
 </AppShell>;
}
