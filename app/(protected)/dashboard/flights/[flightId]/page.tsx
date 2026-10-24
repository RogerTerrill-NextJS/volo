import type {Metadata} from 'next';
import Link from 'next/link';
import {notFound,redirect} from 'next/navigation';
import {getPageAccess} from '../../../../../lib/auth/page-access';
import {getFlightDetail} from '../../../../../lib/flights/detail-query';
import AppShell from '../../../_components/app-shell';
import AccessState from '../../../_components/access-state';
import FlightDetails from './flight-details';
import InterestForm,{type InterestMode} from './interest-form';
import {getOwnFlightInterest} from '../../../../../lib/flights/interest-query';
import {Suspense} from 'react';
import IncomingRequests,{IncomingLoading} from './incoming-requests';

export const metadata:Metadata={title:'Flight detail | Volo',robots:{index:false,follow:false}};
const linkClass='inline-flex min-h-11 w-fit items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4';

export default async function FlightDetailPage({params,searchParams}:{params:Promise<{flightId:string}>;searchParams:Promise<{[key:string]:string|string[]|undefined}>}){
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
 let interest:InterestMode='error';
 if(!result.flight.isOwn){
  const own=await getOwnFlightInterest(result.flight.id);
  if(own.status!=='authorized'){
   if(own.status==='unauthenticated')redirect('/login?reason=authentication-required');
   if(own.status==='forbidden')return <AccessState status="forbidden"/>;
   if(own.status==='missing')notFound();
   return <AccessState status="unavailable" retryHref={`/dashboard/flights/${result.flight.id}`}/>;
  }
  if(own.requestStatus==='pending'||own.requestStatus==='accepted')interest=own.requestStatus;
  else if(own.requestStatus==='declined'||own.requestStatus==='cancelled')interest='closed';
  else if(own.requestStatus==='unavailable')interest='error';
  else if(result.flight.isPast||result.flight.status!=='open')interest='flight_unavailable';
  else if(own.profileStatus==='missing')interest='profile_required';
  else if(own.profileStatus==='unavailable')interest='error';
  else interest=own.requestStatus==='withdrawn'?'resubmit':'ready';
 }
 const query=result.flight.isOwn?await searchParams:{};
 return <AppShell isAdmin={access.member.role==='admin'}>
  <Link href="/dashboard/flights" prefetch={false} className={linkClass}><span aria-hidden="true" className="mr-2">←</span>Back to upcoming flights</Link>
  {result.flight.isOwn&&!result.flight.isPast&&result.flight.status==='open'&&<Link href={`/dashboard/flights/${result.flight.id}/edit`} prefetch={false} className={linkClass}>Edit flight</Link>}
  <FlightDetails flight={result.flight} pilot={result.pilot} ownerActions={result.flight.isOwn?<Suspense key={JSON.stringify(query.requestsAfter??null)} fallback={<IncomingLoading/>}><IncomingRequests flightId={result.flight.id} after={query.requestsAfter}/></Suspense>:undefined} joinerActions={!result.flight.isOwn?<InterestForm flightId={result.flight.id} mode={interest}/>:undefined}/>
 </AppShell>;
}
