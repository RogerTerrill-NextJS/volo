import type {Metadata} from 'next';
import Link from '../../_components/progress-link';
import {redirect} from 'next/navigation';
import {getPageAccess} from '../../../lib/auth/page-access';
import {getOwnProfileStatus} from '../../../lib/profiles/query';
import AppShell from '../_components/app-shell';
import AccessState from '../_components/access-state';
import ProfileForm from './profile-form';

export const metadata:Metadata={title:'Complete your pilot profile | Volo',robots:{index:false,follow:false}};
export default async function OnboardingPage(){
 const access=await getPageAccess();
 if(access.status!=='authorized')return <AccessState status={access.status}/>;
 const profile=await getOwnProfileStatus(access.member);
 if(profile==='complete')redirect('/dashboard?from=profile-onboarding');
 return <AppShell isAdmin={access.member.role==='admin'}>
  <header className="max-w-xl space-y-3"><h1 className="text-3xl font-semibold tracking-tight">{profile==='missing'?'Complete your pilot profile':'Profile temporarily unavailable'}</h1>
   <p className="text-zinc-600">{profile==='missing'?'Tell other pilots a little about yourself. You can continue browsing and complete your profile later.':'We could not check your profile. Try again before submitting.'}</p>
  </header>
  {profile==='unavailable'&&<a href="/onboarding" className="w-fit underline underline-offset-4">Try again</a>}
  <ProfileForm unavailable={profile==='unavailable'}/>
  <Link href="/dashboard" prefetch={false} className="w-fit underline underline-offset-4">Continue browsing</Link>
 </AppShell>;
}
