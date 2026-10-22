import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import {getPageAccess} from '../lib/auth/page-access';
import AccessState from './(protected)/_components/access-state';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Volo',robots:{index:false,follow:false}};

export default async function Home(){
 const access=await getPageAccess();
 // A fixed query prevents Netlify from inheriting incoming redirect/token parameters.
 if(access.status==='authorized')redirect('/dashboard/flights?source=home');
 return <div className="mx-auto w-full max-w-5xl px-6 py-12 sm:py-16"><AccessState status={access.status} retryHref="/"/></div>;
}
