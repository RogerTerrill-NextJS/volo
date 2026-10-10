import type { Metadata } from "next";
import Link from "next/link";
import {loginResultMessage} from '../../lib/auth/login-feedback';
import LoginForm from './login-form';

export const metadata: Metadata = {
  title: "Sign in | Volo",
  description: "Sign in to your Volo workspace.",
  robots: {index:false,follow:false},
  referrer: 'no-referrer',
};

export const dynamic='force-dynamic';
export default async function LoginPage({searchParams}:{searchParams:Promise<{[key:string]:string|string[]|undefined}>}) {
  const query=await searchParams;
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-12 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
      <p className="text-zinc-600 dark:text-zinc-400">Sign in with the email and password for your invited account.</p>
      <LoginForm message={loginResultMessage(query.result)}/>
      <Link href="/" className="w-fit text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">
        Back to home
      </Link>
    </main>
  );
}
