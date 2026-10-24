import type {Metadata} from 'next';
import Link from 'next/link';
import {notFound,redirect} from 'next/navigation';
import {getPageAccess} from '../../../../../../lib/auth/page-access';
import {getFlightEdit} from '../../../../../../lib/flights/edit-query';
import AppShell from '../../../../_components/app-shell';
import AccessState from '../../../../_components/access-state';
import FlightForm from '../../new/flight-form';
import {saveFlight} from './actions';
export const metadata:Metadata={title:'Edit flight | Volo',robots:{index:false,follow:false}};
export default async function EditFlightPage({params}:{params:Promise<{flightId:string}>}){
 const access=await getPageAccess();if(access.status!=='authorized')return <AccessState status={access.status}/>;
 const {flightId}=await params,result=await getFlightEdit(flightId);
 if(result.status==='unauthenticated')redirect('/login?reason=authentication-required');
 if(result.status==='missing')notFound();
 if(result.status==='forbidden')return <AccessState status="forbidden"/>;
 return <AppShell isAdmin={access.member.role==='admin'}>
  <Link href={`/dashboard/flights/${encodeURIComponent(flightId)}`} prefetch={false} className="inline-flex min-h-11 items-center underline underline-offset-4">Back to flight</Link>
  <header className="max-w-xl space-y-3"><h1 className="text-3xl font-semibold tracking-tight">Edit flight</h1><p>Update the flight plan, notes or joining-pilot capacity.</p></header>
  {result.status==='authorized'?<FlightForm publish={saveFlight} edit={result}/>:<section role="alert" className="space-y-4"><p>{result.status==='closed'?'Only open, upcoming flights can be edited.':result.status==='profile_required'?'Complete your pilot profile before editing a flight.':'Flight editing is temporarily unavailable. Reload before making changes.'}</p>{result.status==='profile_required'?<Link href="/onboarding" prefetch={false} className="underline">Complete your pilot profile</Link>:result.status==='unavailable'?<form action={`/dashboard/flights/${encodeURIComponent(flightId)}/edit`} method="get"><button className="min-h-11 underline">Reload current flight</button></form>:null}</section>}
 </AppShell>;
}
