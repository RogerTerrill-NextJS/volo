import type {Metadata} from 'next';
import Link from 'next/link';
import {getPageAccess} from '../../../../../lib/auth/page-access';
import {getOwnProfileStatus} from '../../../../../lib/profiles/query';
import AppShell from '../../../_components/app-shell';
import AccessState from '../../../_components/access-state';
import FlightForm from './flight-form';
import {publishFlight} from './actions';

export const metadata:Metadata={title:'Post a flight | Volo',robots:{index:false,follow:false}};
export default async function NewFlightPage(){
 const access=await getPageAccess();
 if(access.status!=='authorized')return <AccessState status={access.status}/>;
 const profile=await getOwnProfileStatus(access.member);
 return <AppShell isAdmin={access.member.role==='admin'}>
  <header className="max-w-xl space-y-3">
   <h1 className="text-3xl font-semibold tracking-tight">Post a flight</h1>
   <p className="text-zinc-600 dark:text-zinc-400">Post an upcoming flight and choose who can see it. Use the local departure date, time and timezone.</p>
  </header>
  {profile==='complete'?<FlightForm publish={publishFlight}/>:profile==='missing'?<section className="space-y-3">
   <h2 className="text-xl font-semibold">Complete your pilot profile first</h2>
   <p>You need a completed licensed-pilot profile to post a flight.</p>
   <Link href="/onboarding" prefetch={false} className="inline-block py-3 underline underline-offset-4">Complete profile</Link>
  </section>:<div role="status" className="space-y-3">
   <p>Your profile could not be checked. Try again before posting.</p>
   {/* Reload this URL to recheck the profile rather than reuse the current route. */}
   {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
   <a href="/dashboard/flights/new" className="inline-block py-3 underline underline-offset-4">Try again</a>
  </div>}
  <Link href="/dashboard" prefetch={false} className="w-fit py-3 underline underline-offset-4">Back to dashboard</Link>
 </AppShell>;
}
