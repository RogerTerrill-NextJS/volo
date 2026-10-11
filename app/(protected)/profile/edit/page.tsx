import type {Metadata} from 'next';
import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getPageAccess} from '../../../../lib/auth/page-access';
import {getOwnProfile} from '../../../../lib/profiles/query';
import {profileFormValues} from '../../../../lib/profiles/form-state';
import AppShell from '../../_components/app-shell';
import AccessState from '../../_components/access-state';
import ProfileForm from '../../_components/profile-form';
import {saveProfile} from './actions';

export const metadata:Metadata={title:'Edit your pilot profile | Volo',robots:{index:false,follow:false}};
export default async function EditProfilePage(){
 const access=await getPageAccess();
 if(access.status!=='authorized')return <AccessState status={access.status}/>;
 const result=await getOwnProfile(access.member);
 if(result.status==='missing')redirect('/onboarding');
 return <AppShell isAdmin={access.member.role==='admin'}>
  <header className="max-w-xl space-y-3"><h1 className="text-3xl font-semibold tracking-tight">{result.status==='complete'?'Edit your pilot profile':'Profile temporarily unavailable'}</h1>
   <p className="text-zinc-600 dark:text-zinc-400">{result.status==='complete'?'Update the details other pilots see about you.':'We could not load your profile. Try again before submitting.'}</p>
  </header>
  {result.status==='unavailable'&&<a href="/profile/edit" className="w-fit underline underline-offset-4">Try again</a>}
  <ProfileForm unavailable={result.status==='unavailable'} initial={{revision:0,values:result.status==='complete'?profileFormValues(result.profile):{},fieldErrors:{},message:null,reload:false}} save={saveProfile} permalink="/profile/edit" submitLabel="Save profile"/>
  <Link href="/dashboard" prefetch={false} className="w-fit underline underline-offset-4">Back to dashboard</Link>
 </AppShell>;
}
