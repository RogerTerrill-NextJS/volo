import type {Metadata} from 'next';
import Link from 'next/link';
import {notFound,redirect} from 'next/navigation';
import {getPageAccess} from '../../../../../lib/auth/page-access';
import {getFlightDetail} from '../../../../../lib/flights/detail-query';
import AppShell from '../../../_components/app-shell';
import AccessState from '../../../_components/access-state';
import FlightDetails from './flight-details';

export const metadata:Metadata={title:'Flight detail | Volo',robots:{index:false,follow:false}};
const linkClass='inline-flex min-h-11 w-fit items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4';

export default async function FlightDetailPage({params}:{params:Promise<{flightId:string}>}){
 const access=await getPageAccess();
 if(access.status!=='authorized')return <AccessState status={access.status} retryHref="/dashboard/flights"/>;
 const {flightId}=await params;
 const result=await getFlightDetail(flightId);
 if(result.status!=='authorized'){
  if(result.status==='unauthenticated')redirect('/login?reason=authentication-required');
  if(result.status==='forbidden')return <AccessState status="forbidden"/>;
  if(result.status==='missing')notFound();
  return <AppShell isAdmin={access.member.role==='admin'}>
   <section className="space-y-4" role="alert" aria-labelledby="flight-state-heading">
    <h1 id="flight-state-heading" className="text-3xl font-semibold tracking-tight">Flight temporarily unavailable</h1>
    <p>We could not load this flight. Please try again.</p>
    <a href={`/dashboard/flights/${encodeURIComponent(flightId)}`} className={linkClass}>Try again</a>
   </section>
   <Link href="/dashboard/flights" prefetch={false} className={linkClass}>Back to upcoming flights</Link>
  </AppShell>;
 }
 return <AppShell isAdmin={access.member.role==='admin'}>
  <Link href="/dashboard/flights" prefetch={false} className={linkClass}><span aria-hidden="true" className="mr-2">←</span>Back to upcoming flights</Link>
  {/* Later owner/edit and joiner/request tickets supply their authorized action slots. */}
  <FlightDetails flight={result.flight} pilot={result.pilot}/>
 </AppShell>;
}
