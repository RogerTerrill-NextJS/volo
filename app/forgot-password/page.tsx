import type {Metadata} from 'next';
import Link from 'next/link';
import {passwordRecoveryMessage} from '../../lib/auth/password-recovery-feedback';
import RecoveryForm from './recovery-form';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Reset password | Volo',description:'Request a password reset link.',robots:{index:false,follow:false},referrer:'no-referrer'};
export default async function ForgotPasswordPage({searchParams}:{searchParams:Promise<{[key:string]:string|string[]|undefined}>}){
 const query=await searchParams;
 return <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-12 sm:py-16">
  <h1 className="text-3xl font-semibold tracking-tight">Forgot your password?</h1>
  <p className="text-zinc-600 dark:text-zinc-400">Enter the email address for your Volo account to request a reset link.</p>
  <RecoveryForm message={passwordRecoveryMessage(query.result)}/>
  <Link href="/login" className="w-fit text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Back to sign in</Link>
 </main>;
}
