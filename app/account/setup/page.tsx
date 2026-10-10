import type {Metadata} from 'next';
import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getVerifiedInvitationSetup,getInvitationCompletionCsrf} from '../../../lib/auth/invitation-setup';
import {getAccess} from '../../../lib/auth/access';
import PasswordSetupForm from './password-form';
import {setupResultMessage} from '../../../lib/auth/invitation-setup-feedback';

export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Complete your account | Volo',description:'Set your password to complete your invited Volo account.',robots:{index:false,follow:false},referrer:'no-referrer'};
export default async function AccountSetupPage({searchParams}:{searchParams:Promise<{[key:string]:string|string[]|undefined}>}) {
 const query=await searchParams;
 // Canonicalize untrusted query input before Next serializes page props.
 if(Object.keys(query).some(key=>!['result','_rsc'].includes(key))||(query.result!==undefined&&!setupResultMessage(query.result)))redirect('/account/setup?result=invalid_input');
 const setup=await getVerifiedInvitationSetup();
 let csrf:string|null=null,status:'form'|'denied'|'unavailable'=setup.status==='unavailable'?'unavailable':'denied';
 if(setup.status==='authorized'){
  csrf=await getInvitationCompletionCsrf();status=csrf?'form':'unavailable';
 }else if(setup.status==='denied'){
  const access=await getAccess();
  if(access.status==='authorized')redirect('/dashboard?from=account-setup');
  if(access.status==='unauthenticated')redirect('/login?reason=authentication-required');
  if(access.status==='unavailable')status='unavailable';
 }
 const message=setupResultMessage(query.result);
 return <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-12 sm:py-16">
  <div className="space-y-3">
   <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Volo</p>
   <h1 className="text-3xl font-semibold tracking-tight">{status==='form'?'Complete your account':status==='unavailable'?'Setup is temporarily unavailable':'Invitation required'}</h1>
   <p className="text-zinc-600 dark:text-zinc-400">{status==='form'?'Choose a password to finish setting up your invited account.':status==='unavailable'?'We could not check your invitation. Wait a moment, then try again.':'Open your invitation email to continue. If your setup session has ended, ask the person who invited you to renew your invitation.'}</p>
  </div>
  {status==='form'&&csrf?<PasswordSetupForm csrf={csrf} message={message}/>:<>
   {status==='unavailable'&&<a href="/account/setup" className="w-fit rounded-lg border border-zinc-300 px-4 py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-4 dark:border-zinc-700">Try again</a>}
   <Link href="/" prefetch={false} className="w-fit text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Back to home</Link>
  </>}
 </main>;
}
