import type {Metadata} from 'next';
import Link from 'next/link';
import {getPasswordRecovery} from '../../lib/auth/password-reset';
import {passwordResetMessage} from '../../lib/auth/password-reset-feedback';
import PasswordSetupForm from '../account/setup/password-form';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Choose a new password | Volo',robots:{index:false,follow:false},referrer:'no-referrer'};
export default async function ResetPasswordPage({searchParams}:{searchParams:Promise<{[key:string]:string|string[]|undefined}>}){
 const query=await searchParams,recovery=await getPasswordRecovery(),message=passwordResetMessage(query.result);
 return <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-12 sm:py-16">
  <h1 className="text-3xl font-semibold tracking-tight">{recovery.status==='authorized'?'Choose a new password':recovery.status==='unavailable'?'Reset is temporarily unavailable':'Reset link required'}</h1>
  {recovery.status==='authorized'?<PasswordSetupForm csrf={recovery.csrf} message={message} purpose="recovery"/>:<p>{message??(recovery.status==='unavailable'?'Wait a moment, then try again.':'Open your password reset email or request a new link.')}</p>}
  <Link href="/forgot-password" prefetch={false} className="w-fit text-sm font-medium underline underline-offset-4">Request a new reset link</Link>
  <Link href="/login" prefetch={false} className="w-fit text-sm font-medium underline underline-offset-4">Back to sign in</Link>
 </main>;
}
